import express from "express";
import cors from "cors";
import { TranslationError } from "./translator.js";

export function createApp({ translate, model }) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "16kb" }));

  // Liveness only: this endpoint does not load or query the model.
  app.get("/", (req, res) => {
    res.json({ ok: true, message: "AI Word Helper server is running", provider: "ollama", model });
  });

  app.post("/translate", async (req, res) => {
    const { word, sentence } = req.body || {};
    if (
      typeof word !== "string" || !word.trim() || word.length > 100 ||
      typeof sentence !== "string" || !sentence.trim() || sentence.length > 4000
    ) {
      return res.status(400).json({
        error: "bad_request",
        details: "Нужны слово (до 100 символов) и предложение (до 4000 символов)."
      });
    }
    try {
      res.json(await translate({ word: word.trim(), sentence }));
    } catch (error) {
      if (error instanceof TranslationError) {
        return res.status(error.status).json({ error: error.code, details: error.message });
      }
      console.error("Translation failed:", error?.message);
      res.status(500).json({ error: "translation_failed", details: "Не удалось получить перевод." });
    }
  });

  app.use((error, req, res, next) => {
    if (error.type === "entity.too.large") {
      return res.status(413).json({ error: "bad_request", details: "Слишком большой запрос." });
    }
    if (error.type === "entity.parse.failed") {
      return res.status(400).json({ error: "bad_request", details: "Некорректный JSON запроса." });
    }
    next(error);
  });
  return app;
}
