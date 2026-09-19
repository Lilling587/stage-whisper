/// <reference lib="webworker" />
/**
 * Runs Swedish speech recognition entirely on this computer.
 * The model is downloaded once and then cached by the browser, so later
 * shows work without any internet connection.
 */
import {
  env,
  AutoProcessor,
  AutoTokenizer,
  WhisperForConditionalGeneration,
  AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";

// I skrivbordsversionen ligger modellen inbyggd i programmet, så inget
// behöver hämtas från nätet. I webbversionen hämtas den en gång och cachas.
const BUNDLED = import.meta.env["VITE_BUNDLED_MODEL"] === "1";

if (BUNDLED) {
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = `${self.location.origin}/models/`;
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = `${self.location.origin}/ort/`;
  }
} else {
  env.allowLocalModels = false;
}

const MODEL_ID = "Xenova/whisper-base";

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function post(message: unknown) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
}

// Delarna laddas var för sig i stället för via pipeline(), eftersom
// pipeline() frågar modellnavet på nätet efter vilka filer som finns.
async function getPipeline(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (asr) return asr;
  if (!loading) {
    const progress_callback = (progress: unknown) => {
      const p = progress as { status?: string; progress?: number };
      if (p.status === "progress" && typeof p.progress === "number") {
        post({ type: "progress", progress: p.progress });
      }
    };
    loading = Promise.all([
      AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback }),
      AutoProcessor.from_pretrained(MODEL_ID, { progress_callback }),
      WhisperForConditionalGeneration.from_pretrained(MODEL_ID, {
        dtype: "q8",
        progress_callback,
      }),
    ]).then(([tokenizer, processor, model]) => {
      asr = new AutomaticSpeechRecognitionPipeline({
        task: "automatic-speech-recognition",
        model,
        tokenizer,
        processor,
      } as never);
      post({ type: "ready" });
      return asr;
    });
  }
  return loading;
}

self.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as
    | { type: "load" }
    | { type: "transcribe"; id: string; pcm: Float32Array };

  if (data.type === "load") {
    void getPipeline().catch((err: unknown) => {
      loading = null;
      post({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Talmodellen kunde inte laddas.",
      });
    });
    return;
  }

  if (data.type === "transcribe") {
    void (async () => {
      try {
        const model = await getPipeline();
        const output = (await model(data.pcm, {
          language: "swedish",
          task: "transcribe",
          chunk_length_s: 30,
        })) as { text?: string } | Array<{ text?: string }>;
        const text = Array.isArray(output)
          ? (output[0]?.text ?? "")
          : (output.text ?? "");
        post({ type: "result", id: data.id, text: text.trim() });
      } catch (err: unknown) {
        post({
          type: "result",
          id: data.id,
          text: "",
          error:
            err instanceof Error ? err.message : "Igenkänningen misslyckades.",
        });
      }
    })();
  }
});
