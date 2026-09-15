/**
 * Captures microphone/line-in audio as PCM, splits it into speech segments
 * with a simple level-based voice activity detector, and hands each segment
 * back as a complete 16 kHz mono WAV blob.
 */

export interface AudioCaptureOptions {
  deviceId?: string | undefined;
  onSegment: (wav: Blob) => void;
  onLevel?: (rms: number) => void;
  onError?: (message: string) => void;
}

const TARGET_SAMPLE_RATE = 16000;
const BLOCK_SIZE = 4096;
const SILENCE_MS_TO_END = 700;
const MAX_SEGMENT_MS = 10000;
const MIN_SEGMENT_MS = 400;
const MIN_WAV_BYTES = 2048; // header-only / empty segments

function downsample(chunks: Float32Array[], fromRate: number): Float32Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const input = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    input.set(c, offset);
    offset += c.length;
  }
  if (fromRate === TARGET_SAMPLE_RATE) return input;
  const ratio = fromRate / TARGET_SAMPLE_RATE;
  const outLength = Math.floor(total / ratio);
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx]!;
    const b = input[idx + 1] ?? a;
    output[i] = a + (b - a) * frac;
  }
  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export class AudioCapture {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
   private source: MediaStreamAudioSourceNode | null = null;
  private silentGain: GainNode | null = null;

  private chunks: Float32Array[] = [];
  private speechMs = 0;
  private silenceMs = 0;
  private inSpeech = false;
  private noiseFloor = 0.005;
  private lastLevelSent = 0;

  async start(options: AudioCaptureOptions): Promise<void> {
    let stream: MediaStream;
    try {
      const constraints: MediaTrackConstraints = {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };
      if (options.deviceId) {
        constraints.deviceId = { exact: options.deviceId };
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: constraints,
      });
    } catch {
      options.onError?.(
        "Kunde inte komma åt ljudingången. Kontrollera att webbläsaren får använda mikrofonen.",
      );
      return;
    }

    this.stream = stream;
    this.chunks = [];
    this.inSpeech = false;
    this.speechMs = 0;
    this.silenceMs = 0;

    const ctx = new AudioContext();
    this.ctx = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(BLOCK_SIZE, 1, 1);
    this.source = source;
    this.node = node;

    const msPerBlock = (BLOCK_SIZE / ctx.sampleRate) * 1000;

    node.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i]! * data[i]!;
      const rms = Math.sqrt(sum / data.length);

      // Throttle level updates (~15/s)
      const now = performance.now();
      if (options.onLevel && now - this.lastLevelSent > 66) {
        this.lastLevelSent = now;
        options.onLevel(rms);
      }

      // Adaptive noise floor + speech threshold
      if (!this.inSpeech) {
        this.noiseFloor = 0.98 * this.noiseFloor + 0.02 * rms;
      }
      const threshold = Math.max(0.008, this.noiseFloor * 3.5);
      const isSpeech = rms > threshold;

      if (isSpeech) {
        if (!this.inSpeech) {
          this.inSpeech = true;
          this.chunks = [];
          this.speechMs = 0;
        }
        this.silenceMs = 0;
      } else if (this.inSpeech) {
        this.silenceMs += msPerBlock;
      }

      if (this.inSpeech) {
        this.chunks.push(new Float32Array(data));
        this.speechMs += msPerBlock;

        const longEnough = this.speechMs >= MIN_SEGMENT_MS;
        const silenceDone = this.silenceMs >= SILENCE_MS_TO_END;
        const tooLong = this.speechMs >= MAX_SEGMENT_MS;
        if ((longEnough && silenceDone) || tooLong) {
          const pcm = downsample(this.chunks, ctx.sampleRate);
          const wav = encodeWav(pcm, TARGET_SAMPLE_RATE);
          if (wav.size >= MIN_WAV_BYTES) options.onSegment(wav);
          this.inSpeech = false;
          this.chunks = [];
          this.speechMs = 0;
          this.silenceMs = 0;
        }
      }
    };

        const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    this.silentGain = silentGain;

    source.connect(node);
    node.connect(silentGain);
    silentGain.connect(ctx.destination);
  }

  async stop(): Promise<void> {
        this.node?.disconnect();
    this.silentGain?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.ctx) await this.ctx.close().catch(() => undefined);
        this.node = null;
    this.silentGain = null;
    this.source = null;
    this.stream = null;
    this.ctx = null;
    this.chunks = [];
    this.inSpeech = false;
  }
}
