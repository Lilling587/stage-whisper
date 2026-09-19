/**
 * Thin browser-side wrapper around the speech recognition worker.
 * Everything runs on this computer — no audio ever leaves the machine.
 */

type Status = "idle" | "loading" | "ready" | "error";

interface Pending {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
}

export class LocalTranscriber {
  private worker: Worker | null = null;
  private pending = new Map<string, Pending>();
  private counter = 0;

  status: Status = "idle";
  progress = 0;

  onStatus?: (status: Status, progress: number, message?: string) => void;

  private emit(message?: string) {
    this.onStatus?.(this.status, this.progress, message);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(
      new URL("./whisper-worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.addEventListener("message", (event: MessageEvent) => {
      const data = event.data as {
        type: string;
        id?: string;
        text?: string;
        error?: string;
        message?: string;
        progress?: number;
      };
      if (data.type === "progress") {
        this.status = "loading";
        this.progress = Math.round(data.progress ?? 0);
        this.emit();
      } else if (data.type === "ready") {
        this.status = "ready";
        this.progress = 100;
        this.emit();
      } else if (data.type === "error") {
        this.status = "error";
        this.emit(data.message);
      } else if (data.type === "result" && data.id) {
        const pending = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (!pending) return;
        if (data.error) pending.reject(new Error(data.error));
        else pending.resolve(data.text ?? "");
      }
    });
    this.worker = worker;
    return worker;
  }

  load(): void {
    const worker = this.ensureWorker();
    if (this.status === "idle" || this.status === "error") {
      this.status = "loading";
      this.emit();
      worker.postMessage({ type: "load" });
    }
  }

  transcribe(pcm: Float32Array): Promise<string> {
    const worker = this.ensureWorker();
    const id = `${++this.counter}`;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: "transcribe", id, pcm }, [pcm.buffer]);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this.status = "idle";
  }
}
