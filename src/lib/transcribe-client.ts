/**
 * Uploads one WAV segment to the transcribe endpoint and streams back
 * the transcript as it is recognized.
 */
export async function transcribeSegment(
  wav: Blob,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData();
  form.append("audio", wav, "segment.wav");

  const res = await fetch(`${getServerBaseUrl()}/api/public/transcribe`, {
    method: "POST",
    body: form,
    signal: signal ?? null,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Transkriberingen misslyckades (${res.status}).`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const line = event
        .split("\n")
        .find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as {
          type?: string;
          delta?: string;
          text?: string;
        };
        if (parsed.type === "transcript.text.delta" && parsed.delta) {
          full += parsed.delta;
          onDelta(full);
        } else if (parsed.type === "transcript.text.done" && parsed.text) {
          full = parsed.text;
          onDelta(full);
        }
      } catch {
        // Ignore malformed SSE payloads.
      }
    }
  }

  return full.trim();
}
