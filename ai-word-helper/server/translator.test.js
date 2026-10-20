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
