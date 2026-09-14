import { createFileRoute } from "@tanstack/react-router";

const MAX_AUDIO_BYTES = 14 * 1024 * 1024; // gemini-3.5-transcribe cap
const MIN_AUDIO_BYTES = 2048; // header-only / empty recordings

export const Route = createFileRoute("/api/public/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) {
          return Response.json(
            { error: "Transkriberingen är inte konfigurerad (saknar nyckel)." },
            { status: 500 },
          );
        }

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return Response.json(
            { error: "Ogiltig uppladdning." },
            { status: 400 },
          );
        }

        const audio = form.get("audio");
        if (!(audio instanceof File) || audio.size === 0) {
          return Response.json(
            { error: "Ingen ljudfil skickades." },
            { status: 400 },
          );
        }
        if (audio.size < MIN_AUDIO_BYTES) {
          return Response.json(
            { error: "Ljudklippet var tomt." },
            { status: 400 },
          );
        }
        if (audio.size > MAX_AUDIO_BYTES) {
          return Response.json(
            { error: "Ljudklippet är för stort." },
            { status: 413 },
          );
        }

        const upstream = new FormData();
        upstream.append("model", "google/gemini-3.5-transcribe");
        upstream.append("language", "sv");
        upstream.append("stream", "true");
        upstream.append("file", audio, "segment.wav");

        let response: Response;
        try {
          response = await fetch(
            "https://ai.gateway.lovable.dev/v1/audio/transcriptions",
            {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}` },
              body: upstream,
              signal: request.signal ?? null,
            },
          );
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return new Response(null, { status: 499 });
          }
          throw err;
        }

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          return new Response(
            body || `Transkriberingen misslyckades (${response.status}).`,
            { status: response.status },
          );
        }

        return new Response(response.body, {
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    },
  },
});
