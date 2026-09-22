import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioCapture } from "@/lib/audio-capture";
import { LocalTranscriber } from "@/lib/local-transcriber";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Intercomtext — live-textning mellan FOH och scen" },
      {
        name: "description",
        content:
          "Skriver om intercomsamtal till svensk text i realtid, direkt i datorn utan moln, visat i stor stil på skärmen.",
      },
      {
        property: "og:title",
        content: "Intercomtext — live-textning mellan FOH och scen",
      },
      {
        property: "og:description",
        content:
          "Skriver om intercomsamtal till svensk text i realtid, direkt i datorn utan moln, visat i stor stil på skärmen.",
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

export function Index() {
  const [role, setRole] = useState<Role | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [started, setStarted] = useState(false);

  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fontScale, setFontScale] = useState(1);
  const [modelStatus, setModelStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [modelProgress, setModelProgress] = useState(0);

  const captureRef = useRef<AudioCapture | null>(null);
  const transcriberRef = useRef<LocalTranscriber | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const levelThrottleRef = useRef(0);
  const stoppedRef = useRef(false);

  // Restore previous choices after hydration
  useEffect(() => {
    const savedRole = loadSetting("intercomtext:source");
    const savedDevice = loadSetting("intercomtext:device");
    if (savedRole === "foh" || savedRole === "scen") setRole(savedRole);
    if (savedDevice) setDeviceId(savedDevice);
  }, []);

  // Enumerate audio inputs, and keep the list live when hardware is
  // plugged in or unplugged.
  useEffect(() => {
    if (started) return;
    const media = navigator.mediaDevices;
    if (!media) return;
    let cancelled = false;

    const refresh = () => {
      media
        .enumerateDevices()
        .then((all) => {
          if (cancelled) return;
          const inputs = all.filter((d) => d.kind === "audioinput");
          setDevices(inputs);

          // Re-select the previously used sound card when it is present.
          const savedId = loadSetting("intercomtext:device");
          const savedLabel = loadSetting("intercomtext:deviceLabel");
          setDeviceId((current) => {
            if (current && inputs.some((d) => d.deviceId === current)) {
              return current;
            }
            const byId = savedId
              ? inputs.find((d) => d.deviceId === savedId)
              : undefined;
            if (byId) return byId.deviceId;
            const byLabel = savedLabel
              ? inputs.find((d) => d.label && d.label === savedLabel)
              : undefined;
            if (byLabel) return byLabel.deviceId;
            return current && inputs.length ? "" : current;
          });
        })
        .catch(() => undefined);
    };

    refresh();
    media.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      media.removeEventListener?.("devicechange", refresh);
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

  // Load the speech model into this computer as soon as the screen opens.
  useEffect(() => {
    if (!started) return;
    const transcriber = new LocalTranscriber();
    transcriber.onStatus = (status, progress, message) => {
      setModelStatus(status);
      setModelProgress(progress);
      if (status === "error" && message) setError(message);
    };
    transcriberRef.current = transcriber;
    transcriber.load();
    return () => {
      transcriber.dispose();
      transcriberRef.current = null;
    };
  }, [started]);

  const handleSegment = useCallback(
    (pcm: Float32Array) => {
      const transcriber = transcriberRef.current;
      if (!role || !transcriber) return;
      const currentRole = role;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const line: Line = {
        id,
        role: currentRole,
        text: "…",
        final: false,
        ts: Date.now(),
      };
      upsertLine(line);

      // Serialize recognition so lines stay in order
      queueRef.current = queueRef.current.then(async () => {
        try {
          const text = await transcriber.transcribe(pcm);
          if (stoppedRef.current) {
            setLines((prev) => prev.filter((l) => l.id !== id));
            return;
          }
          if (text) {
            upsertLine({ ...line, text, final: true });
          } else {
            setLines((prev) => prev.filter((l) => l.id !== id));
          }
        } catch (err) {
          setLines((prev) => prev.filter((l) => l.id !== id));
          setError(
            err instanceof Error ? err.message : "Igenkänningen misslyckades.",
          );
        }
      });
    },
    [role, upsertLine],
  );

  const startListening = useCallback(async () => {
    if (captureRef.current) return;
    setError(null);
    stoppedRef.current = false;
    transcriberRef.current?.load();
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
    try {
      wakeLockRef.current = await navigator.wakeLock?.request("screen");
    } catch {
      // Not supported in this browser, or the tab wasn't visible at the
      // moment we asked — the visibility watcher below retries later.
    }
  }, [deviceId, handleSegment]);

  const stopListening = useCallback(async () => {
    stoppedRef.current = true;
    setListening(false);
    setLevel(0);
    void wakeLockRef.current?.release();
    wakeLockRef.current = null;
    await captureRef.current?.stop();
    captureRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      void wakeLockRef.current?.release();
      void captureRef.current?.stop();
    };
  }, []);

  // Auto-scroll to newest line
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  // The Wake Lock API releases itself whenever the tab is hidden (e.g. you
  // alt-tab away for a second). Re-acquire it automatically once it's
  // visible again, so the screen doesn't quietly go dark mid-show.
  useEffect(() => {
    const reacquire = () => {
      if (
        listening &&
        document.visibilityState === "visible" &&
        !wakeLockRef.current
      ) {
        void navigator.wakeLock
          ?.request("screen")
          .then((lock) => {
            wakeLockRef.current = lock;
          })
          .catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", reacquire);
    return () => document.removeEventListener("visibilitychange", reacquire);
  }, [listening]);

  const clearLines = useCallback(() => setLines([]), []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  }, []);

  const start = useCallback(() => {
    if (!role) return;
    try {
      window.localStorage.setItem("intercomtext:source", role);
      if (deviceId) window.localStorage.setItem("intercomtext:device", deviceId);
    } catch {
      // ignore
    }
    setStarted(true);
  }, [role, deviceId]);

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
            Talet skrivs om till text direkt i den här datorn. Ljudet lämnar
            aldrig datorn och ingenting sparas.
          </p>

          <fieldset className="mt-6">
            <legend className="text-sm font-medium text-foreground">
              Vem lyssnar den här skärmen på?
            </legend>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {(["scen", "foh"] as Role[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                    role === r
                      ? r === "foh"
                        ? "border-amber-400 bg-amber-400/10 text-amber-300"
                        : "border-cyan-400 bg-cyan-400/10 text-cyan-300"
                      : "border-border bg-background text-muted-foreground hover:bg-accent"
                  }`}
                >
                  <span className="block text-lg font-semibold">
                    {ROLE_LABEL[r]}
                  </span>
                  <span className="mt-1 block text-xs opacity-80">
                    {r === "scen"
                      ? "Ljudet kommer från scenen — välj detta vid FOH"
                      : "Ljudet kommer från FOH — välj detta på scenen"}
                  </span>
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
            Välj den ingång där motpartens intercomljud kommer in. Webbläsaren
            frågar om behörighet när du startar lyssningen.
          </p>
          <p className="mt-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Första gången hämtas talmodellen en gång (cirka 250 MB) och sparas i
            datorn. Därefter fungerar textningen helt utan internet.
          </p>

          <button
            type="button"
            onClick={start}
            disabled={!role}
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
  const modelLabel =
    modelStatus === "ready"
      ? "Talmodell klar"
      : modelStatus === "loading"
        ? `Hämtar talmodell ${modelProgress} %`
        : modelStatus === "error"
          ? "Talmodell saknas"
          : "Talmodell väntar";

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
              ? `Lyssnar… det som sägs från ${role ? ROLE_LABEL[role] : "motparten"} visas här.`
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
          {role ? `Visar: vad ${ROLE_LABEL[role]} säger` : ""}
        </span>

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
              modelStatus === "ready"
                ? "bg-green-400"
                : modelStatus === "error"
                  ? "bg-destructive"
                  : "bg-amber-400"
            }`}
          />
          {modelLabel}
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
