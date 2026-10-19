import dotenv from "dotenv";
import { createApp } from "./app.js";
import { createTranslator } from "./translator.js";

dotenv.config();

const port = process.env.PORT || 3000;
const model = process.env.OLLAMA_MODEL || "gemma3:4b";
const translate = createTranslator({
  baseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
  model,
  timeoutMs: Number(process.env.AI_TIMEOUT_MS || 120000)
});
const app = createApp({ translate, model });

app.listen(port, "127.0.0.1", () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`Local AI: Ollama / ${model} (no API key required)`);
});
