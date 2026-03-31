import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is missing in .env");
  process.exit(1);
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ ok: true, message: "AI Word Helper server is running" });
});

app.post("/translate", async (req, res) => {
  try {
    const { word, sentence } = req.body || {};

    if (!word || !sentence) {
      return res.status(400).json({
        error: "bad_request",
        details: "word and sentence are required"
      });
    }

    const prompt = `
Ты помощник по изучению английского языка.
Тебе дают английское слово и предложение, где оно используется.

Верни ответ строго в JSON формате:
{
  "word": "...",
  "translation": "...",
  "contextMeaning": "...",
  "partOfSpeech": "...",
  "sentence": "..."
}

Правила:
- translation: короткий перевод на русский
- contextMeaning: что слово значит именно в этом контексте
- partOfSpeech: часть речи максимально кратко
- sentence: верни исходное предложение без изменений
- никаких пояснений вне JSON

Слово: ${word}
Предложение: ${sentence}
`.trim();

    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "Ты отвечаешь только валидным JSON без markdown."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.2
    });

    const text = response.choices?.[0]?.message?.content?.trim();

    if (!text) {
      return res.status(500).json({
        error: "translation_failed",
        details: "Empty response from OpenAI"
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      console.error("Raw model output:", text);

      return res.status(500).json({
        error: "translation_failed",
        details: "Model returned non-JSON response",
        raw: text
      });
    }

    return res.json({
      word: parsed.word || word,
      translation: parsed.translation || "",
      contextMeaning: parsed.contextMeaning || "",
      partOfSpeech: parsed.partOfSpeech || "unknown",
      sentence: parsed.sentence || sentence
    });
  } catch (error) {
    console.error("OpenAI error:", error?.message || error);

    return res.status(500).json({
      error: "translation_failed",
      details: error?.message || "Unknown error"
    });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});