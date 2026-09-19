// Hämtar talmodellen till desktop/public/models så att skrivbordspaketen
// kan köras helt utan internet. Modellfilerna sparas aldrig i repot.
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

const BASE = "https://huggingface.co/Xenova/whisper-base/resolve/main";
const OUT = path.resolve(
  import.meta.dirname,
  "../desktop/public/models/Xenova/whisper-base",
);

const FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
];

await mkdir(path.join(OUT, "onnx"), { recursive: true });

for (const file of FILES) {
  const target = path.join(OUT, file);
  try {
    await access(target);
    console.log(`finns redan: ${file}`);
    continue;
  } catch {
    // saknas, hämta nedan
  }
  console.log(`hämtar: ${file}`);
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`Kunde inte hämta ${file}: ${res.status}`);
  await writeFile(target, Buffer.from(await res.arrayBuffer()));
}

console.log("Talmodellen är klar i desktop/public/models.");
