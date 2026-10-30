import dotenv from "dotenv";
import { createApp } from "./app.js";
import { createTranslator } from "./translator.js";
import { createHybridTranslator } from "./hybrid-translator.js";
import { withTranslationCache } from "./helper/translation-cache.js";

dotenv.config();

const port = process.env.PORT || 3000;
const model = process.env.OLLAMA_MODEL || "gemma3:4b";

const explain = process.env.AI_ENABLED === "false"
  ? undefined
  : createTranslator({
    baseUrl:
      process.env.OLLAMA_BASE_URL ||
      "http://127.0.0.1:11434",
    model,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 120000)
  });

const translate = withTranslationCache(
  createHybridTranslator({
    libreUrl:
      process.env.LIBRETRANSLATE_URL ||
      "http://127.0.0.1:5000",
    nlpUrl:
      process.env.NLP_URL ||
      "http://127.0.0.1:5001",
    timeoutMs: Number(process.env.SERVICE_TIMEOUT_MS || 60000),
    explain
  })
);

const app = createApp({
  translate,
  model,
  provider: "libretranslate+spacy"
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Server: http://localhost:${port}`)
  console.log("Перевод: LibreTranslate; грамматика: spaCy")
  console.log(
    explain
      ? `Объяснение: Ollama / ${model}`
      : "Объяснение выключено"
  );
});
