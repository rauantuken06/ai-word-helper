import test from "node:test";
import assert from "node:assert/strict";
import { createTranslator } from "./translator.js";

const input = { word: "bank", sentence: "We sat on the bank of the river." };
const answer = { translation: "берег", contextMeaning: "Берег реки", partOfSpeech: "существительное" };
const reply = (content = JSON.stringify(answer)) => Response.json({ message: { content } });

test("sends a structured local request and preserves source text", async () => {
  const translate = createTranslator({ fetchImpl: async (url, options) => {
    assert.equal(url.href, "http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "gemma3:4b");
    assert.equal(body.stream, false);
    assert.equal(body.options.temperature, 0.2);
    assert.deepEqual(body.format.required, Object.keys(answer));
    assert.deepEqual(JSON.parse(body.messages[1].content), input);
    assert.equal(options.headers.Authorization, undefined);
    return reply(JSON.stringify({ ...answer, word: "wrong", sentence: "changed" }));
  }});
  assert.deepEqual(await translate(input), { ...input, ...answer });
});

test("rejects remote endpoints, cloud models and invalid timeouts", () => {
  assert.throws(() => createTranslator({ baseUrl: "https://ollama.com" }), /local HTTP/);
  assert.throws(() => createTranslator({ model: "gpt-oss:120b-cloud" }), /local model/);
  for (const timeoutMs of [0, -1, NaN, 1.5, 2147483648]) {
    assert.throws(() => createTranslator({ timeoutMs }), /AI_TIMEOUT_MS/);
  }
});

for (const [status, code] of [[404, "model_not_found"], [500, "ai_unavailable"]]) {
  test(`handles Ollama HTTP ${status}`, async () => {
    const translate = createTranslator({ fetchImpl: async () => new Response("failure", { status }) });
    await assert.rejects(translate(input), error => error.code === code && error.status === 503);
  });
}

for (const [name, code, status] of [
  ["TypeError", "ai_unavailable", 503],
  ["TimeoutError", "ai_timeout", 504],
  ["AbortError", "ai_timeout", 504]
]) {
  test(`handles ${name}`, async () => {
    const translate = createTranslator({ fetchImpl: async () => {
      const error = new Error("test");
      error.name = name;
      throw error;
    }});
    await assert.rejects(translate(input), error => error.code === code && error.status === status);
  });
}

for (const content of ["", "```json\n{}\n```", "null", "{}", JSON.stringify({ ...answer, translation: 42 }), JSON.stringify({ ...answer, contextMeaning: " " })]) {
  test(`rejects invalid model content: ${content}`, async () => {
    const translate = createTranslator({ fetchImpl: async () => reply(content) });
    await assert.rejects(translate(input), { code: "invalid_ai_response", status: 502 });
  });
}

test("rejects a non-JSON HTTP response", async () => {
  const translate = createTranslator({ fetchImpl: async () => new Response("not json") });
  await assert.rejects(translate(input), { code: "invalid_ai_response", status: 502 });
});

test("retries a Chinese answer once and accepts the Russian correction", async () => {
  let calls = 0;
  let firstSignal;
  const translate = createTranslator({ fetchImpl: async (url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    assert.ok(body.format.properties.partOfSpeech.enum.includes("существительное"));
    if (calls === 1) {
      firstSignal = options.signal;
      return reply(JSON.stringify({ translation: "goroutines", contextMeaning: "编译器内置的并发支持", partOfSpeech: "名词" }));
    }
    assert.equal(options.signal, firstSignal);
    assert.match(body.messages[0].content, /Предыдущий ответ/);
    return reply();
  }});
  assert.deepEqual(await translate(input), { ...input, ...answer });
  assert.equal(calls, 2);
});

for (const badAnswer of [
  { ...answer, contextMeaning: "The edge of the river." },
  { ...answer, translation: "河岸" },
  { ...answer, partOfSpeech: "noun" }
]) {
  test(`does not return persistent wrong-language content: ${JSON.stringify(badAnswer)}`, async () => {
    let calls = 0;
    const translate = createTranslator({ fetchImpl: async () => {
      calls++;
      return reply(JSON.stringify(badAnswer));
    }});
    await assert.rejects(translate(input), { code: "invalid_ai_language", status: 502 });
    assert.equal(calls, 2);
  });
}

test("allows a technical name in Latin script with a Russian explanation", async () => {
  const technical = { translation: "JavaScript", contextMeaning: "Язык программирования", partOfSpeech: "существительное" };
  const translate = createTranslator({ fetchImpl: async () => reply(JSON.stringify(technical)) });
  assert.deepEqual(await translate({ word: "JavaScript", sentence: "I use JavaScript." }), {
    word: "JavaScript", sentence: "I use JavaScript.", ...technical
  });
});
