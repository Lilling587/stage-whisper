import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AudioCapture } from "@/lib/audio-capture";
import { transcribeSegment } from "@/lib/transcribe-client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Intercomtext — live-textning mellan FOH och scen" },
      {
        name: "description",
        content:
          "Skriver om intercomsamtal mellan FOH och scen till svensk text i realtid, visat i stor stil på båda skärmarna.",
      },
      { property: "og:title", content: "Intercomtext — live-textning mellan FOH och scen" },
      {
        property: "og:description",
        content:
          "Skriver om intercomsamtal mellan FOH och scen till svensk text i realtid, visat i stor stil på båda skärmarna.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

type Role = "foh" | "scen";

interface Line {
  id: string;
  role: Role;
  text: string;
  final: boolean;
  ts: number;
}

const ROLE_LABEL: Record<Role, string> = { foh: "FOH", scen: "Scen" };
const MAX_LINES = 60;

function loadSetting(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function Index() {
  const [room, setRoom] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [started, setStarted] = useState(false);

  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [fontScale, setFontScale] = useState(1);

  const captureRef = useRef<AudioCapture | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const levelThrottleRef = useRef(0);

  // Restore previous choices after hydration
  useEffect(() => {
    const savedRoom = loadSetting("intercomtext:room");
    const savedRole = loadSetting("intercomtext:role");
    const savedDevice = loadSetting("intercomtext:device");
    if (savedRoom) setRoom(savedRoom);
    if (savedRole === "foh" || savedRole === "scen") setRole(savedRole);
    if (savedDevice) setDeviceId(savedDevice);
  }, []);

  // Enumerate audio inputs when the setup screen is shown
  useEffect(() => {
    if (started) return;
    let cancelled = false;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((all) => {
        if (cancelled) return;
        setDevices(all.filter((d) => d.kind === "audioinput"));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [started]);

  const upsertLine = useCallback((line: Line) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.id === line.id);
      let next: Line[];
      if (idx >= 0) {
        next = [...prev];
        next[idx] = line;
      } else {
        next = [...prev, line];
      }
      next.sort((a, b) => a.ts - b.ts);
      return next.slice(-MAX_LINES);
    });
  }, []);

  // Realtime channel per room
  useEffect(() => {
    if (!started || !room.trim()) return;
    const channel = supabase.channel(`intercomtext-${room.trim().toLowerCase()}`);
    channel
      .on("broadcast", { event: "line" }, ({ payload }) => {
        const line = payload as Line;
        if (line && typeof line.id === "string") upsertLine(line);
      })
      .on("broadcast", { event: "clear" }, () => setLines([]))
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });
    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      setConnected(false);
    };
  }, [started, room, upsertLine]);

  const broadcast = useCallback((event: string, payload: unknown) => {
    channelRef.current?.send({ type: "broadcast", event, payload });
  }, []);

  const publishLine = useCallback(
    (line: Line) => {
      upsertLine(line);
      broadcast("line", line);
    },
    [upsertLine, broadcast],
  );

  const handleSegment = useCallback(
    (wav: Blob) => {
      if (!role) return;
      const currentRole = role;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const line: Line = { id, role: currentRole, text: "…", final: false, ts: Date.now() };
      publishLine(line);

      // Serialize uploads so lines stay in order
      queueRef.current = queueRef.current.then(async () => {
        try {
          const text = await transcribeSegment(wav, (partial) => {
            publishLine({ ...line, text: partial || "…" });
          });
          if (text) {
            publishLine({ ...line, text, final: true });
          } else {
            // Nothing recognized — remove the placeholder line
            setLines((prev) => prev.filter((l) => l.id !== id));
            broadcast("line", { ...line, text: "", final: true });
          }
        } catch (err) {
          setLines((prev) => prev.filter((l) => l.id !== id));
          broadcast("line", { ...line, text: "", final: true });
          setError(
            err instanceof Error
              ? err.message
              : "Transkriberingen misslyckades.",
          );
        }
      });
    },
    [role, publishLine, broadcast],
  );

  const startListening = useCallback(async () => {
    setError(null);
    const capture = new AudioCapture();
    captureRef.current = capture;
    await capture.start({
      deviceId: deviceId || undefined,
      onSegment: handleSegment,
      onLevel: (rms) => {
        const now = performance.now();
        if (now - levelThrottleRef.current > 100) {
          levelThrottleRef.current = now;
          setLevel(Math.min(1, rms * 6));
        }
      },
      onError: (message) => {
        setError(message);
        setListening(false);
      },
    });
    setListening(true);
  }, [deviceId, handleSegment]);

  const stopListening = useCallback(async () => {
    setListening(false);
    setLevel(0);
    await captureRef.current?.stop();
    captureRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      void captureRef.current?.stop();
    };
  }, []);

  // Auto-scroll to newest line
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const clearLines = useCallback(() => {
    setLines([]);
    broadcast("clear", {});
  }, [broadcast]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  }, []);

  const start = useCallback(() => {
    if (!room.trim() || !role) return;
    try {
      window.localStorage.setItem("intercomtext:room", room.trim());
      window.localStorage.setItem("intercomtext:role", role);
      if (deviceId) window.localStorage.setItem("intercomtext:device", deviceId);
    } catch {
      // ignore
    }
    setStarted(true);
  }, [room, role, deviceId]);

  // ---------- Setup screen ----------
  if (!started) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 shadow-xl">
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Intercomtext
          </p>
          <h1 className="mt-2 text-3xl font-bold text-foreground">
            Live-textning av intercom
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Öppna samma rum på FOH-datorn och scendatorn. Allt som sägs skrivs
            ut på båda skärmarna. Ingenting sparas.
          </p>

          <label className="mt-6 block text-sm font-medium text-foreground">
            Rum (t.ex. föreställningens namn)
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="Forestallning-14-sep"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-foreground">
              Den här datorn står vid
            </legend>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {(["foh", "scen"] as Role[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`rounded-lg border px-4 py-3 text-lg font-semibold transition-colors ${
                    role === r
                      ? r === "foh"
                        ? "border-amber-400 bg-amber-400/10 text-amber-300"
                        : "border-cyan-400 bg-cyan-400/10 text-cyan-300"
                      : "border-border bg-background text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="mt-5 block text-sm font-medium text-foreground">
            Ljudingång
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Standard</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Ljudingång ${d.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-xs text-muted-foreground">
            Välj den ingång där intercomljudet kommer in. Webbbläsaren frågar om
            behörighet när du startar lyssningen.
          </p>

          <button
            type="button"
            onClick={start}
            disabled={!room.trim() || !role}
            className="mt-6 w-full rounded-lg bg-primary px-4 py-3 text-lg font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Öppna skärmen
          </button>
        </div>
      </main>
    );
  }

  // ---------- Screen view ----------
  const visible = lines.filter((l) => l.text);
  const lastIndex = visible.length - 1;

  return (
    <main className="flex h-screen flex-col bg-background">
      {/* Lines */}
      <div
        ref={scrollRef}
        className="flex flex-1 flex-col justify-end gap-1 overflow-y-auto px-8 pb-4 pt-8"
      >
        {visible.length === 0 && (
          <p className="mb-auto mt-auto text-center text-xl text-muted-foreground">
            {listening
              ? "Lyssnar… det som sägs i intercomen visas här."
              : "Tryck på Starta lyssning för att börja texta."}
          </p>
        )}
        {visible.map((line, i) => {
          const distance = lastIndex - i;
          const sizeClass =
            distance === 0
              ? "font-semibold"
              : distance === 1
                ? "font-medium opacity-75"
                : distance <= 3
                  ? "opacity-50"
                  : "opacity-30";
          const fontSize =
            distance === 0
              ? `${3.2 * fontScale}rem`
              : distance === 1
                ? `${2 * fontScale}rem`
                : `${1.3 * fontScale}rem`;
          const color =
            line.role === "foh" ? "text-amber-300" : "text-cyan-300";
          return (
            <div key={line.id} className={sizeClass} style={{ fontSize }}>
              <span
                className={`mr-3 align-middle font-mono font-bold uppercase tracking-wider ${color}`}
                style={{ fontSize: "0.45em" }}
              >
                {ROLE_LABEL[line.role]}
              </span>
              <span className="text-foreground">
                {line.text}
                {!line.final && <span className="animate-pulse"> ▌</span>}
              </span>
            </div>
          );
        })}
      </div>

      {/* Error banner */}
      {error && (
        <div className="border-t border-destructive/40 bg-destructive/10 px-8 py-2 text-sm text-destructive-foreground">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-3 underline"
          >
            Stäng
          </button>
        </div>
      )}

      {/* Status bar */}
      <footer className="flex flex-wrap items-center gap-4 border-t border-border px-6 py-3">
        <span
          className={`rounded px-2 py-0.5 font-mono text-xs font-bold uppercase ${
            role === "foh"
              ? "bg-amber-400/15 text-amber-300"
              : "bg-cyan-400/15 text-cyan-300"
          }`}
        >
          {role ? ROLE_LABEL[role] : ""}
        </span>
        <span className="text-xs text-muted-foreground">Rum: {room}</span>

        {/* Level meter */}
        <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-75"
            style={{ width: `${Math.round(level * 100)}%` }}
          />
        </div>

        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              listening ? "bg-green-400" : "bg-muted-foreground"
            }`}
          />
          {listening ? "Lyssnar" : "Stoppad"}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              connected ? "bg-green-400" : "bg-destructive"
            }`}
          />
          {connected ? "Skärmar kopplade" : "Återansluter…"}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFontScale((s) => Math.max(0.6, s - 0.2))}
            className="rounded-md border border-border px-2.5 py-1 text-sm text-foreground hover:bg-accent"
            aria-label="Minska textstorlek"
          >
            A−
          </button>
          <button
            type="button"
            onClick={() => setFontScale((s) => Math.min(2.2, s + 0.2))}
            className="rounded-md border border-border px-2.5 py-1 text-sm text-foreground hover:bg-accent"
            aria-label="Öka textstorlek"
          >
            A+
          </button>
          <button
            type="button"
            onClick={clearLines}
            className="rounded-md border border-border px-3 py-1 text-sm text-foreground hover:bg-accent"
          >
            Rensa
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="rounded-md border border-border px-3 py-1 text-sm text-foreground hover:bg-accent"
          >
            Helskärm
          </button>
          {listening ? (
            <button
              type="button"
              onClick={() => void stopListening()}
              className="rounded-md bg-destructive px-4 py-1.5 text-sm font-semibold text-destructive-foreground hover:opacity-90"
            >
              Stoppa
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void startListening()}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Starta lyssning
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}
