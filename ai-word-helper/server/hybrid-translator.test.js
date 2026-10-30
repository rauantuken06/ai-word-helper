import test from "node:test";
import assert from "node:assert/strict";
import { createHybridTranslator, normalizeSelection } from "./hybrid-translator.js";

const input = { word: "bank", sentence: "A bank.", mode: "quick" };

test("selection is inferred only for a unique whole word", () => {
  assert.deepEqual(normalizeSelection(input), { selectionStart: 2, selectionEnd: 6 });
  assert.throws(() => normalizeSelection({ word: "saw", sentence: "I saw a saw." }), { code: "bad_request" });
  assert.throws(() => normalizeSelection({ word: "bank", sentence: "A banker." }), { code: "bad_request" });
});

test("explicit selection preserves the chosen occurrence and rejects invalid spans", () => {
  assert.deepEqual(normalizeSelection({
    word: "saw", sentence: "I saw a saw.", selectionStart: 8, selectionEnd: 11
  }), { selectionStart: 8, selectionEnd: 11 });
  for (const selection of [
    { selectionStart: 0, selectionEnd: 4 },
    { selectionStart: -1, selectionEnd: 6 },
    { selectionStart: 2 },
    { selectionStart: 2, selectionEnd: 99 }
  ]) {
    assert.throws(() => normalizeSelection({ ...input, ...selection }), { code: "bad_request" });
  }
});

test("quick mode combines valid translation and grammar without invoking Ollama", async t => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url: url.href, body });
    assert.equal(options.headers["Content-Type"], "application/json");
    return url.port === "5000"
      ? Response.json({ translatedText: ["банк", "Банк."] })
      : Response.json({ partOfSpeech: "существительное", lemma: "bank" });
  });
  const translate = createHybridTranslator({ explain: async () => assert.fail("Ollama must not be called") });
  assert.deepEqual(await translate(input), {
    word: "bank", sentence: "A bank.", selectionStart: 2, selectionEnd: 6,
    translation: "банк", sentenceTranslation: "Банк.", partOfSpeech: "существительное",
    lemma: "bank", contextMeaning: "", translationKind: "standalone"
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.find(value => value.url.includes(":5000/")).body.q, [input.word, input.sentence]);
  assert.equal(requests.find(value => value.url.includes(":5001/")).body.selectionStart, 2);
});

test("full mode forwards selection to the explainer and needs no translation services", async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No HTTP calls expected"));
  const translate = createHybridTranslator({ explain: async value => {
    assert.equal(value.selectionStart, 2);
    assert.equal(value.mode, "full");
    return { translation: "банк", contextMeaning: "Финансовое учреждение" };
  }});
  const result = await translate({ ...input, mode: "full" });
  assert.equal(result.translationKind, "contextual");
  assert.equal(result.selectionEnd, 6);
  await assert.rejects(createHybridTranslator()({ ...input, mode: "full" }), { code: "explanation_disabled" });
});

test("empty and null service responses are rejected", async t => {
  let payload = null;
  t.mock.method(globalThis, "fetch", async () => Response.json(payload));
  const translate = createHybridTranslator();
  await assert.rejects(translate(input), { code: "invalid_service_response", status: 502 });
  payload = { translatedText: ["банк", "Банк."], partOfSpeech: " " };
  await assert.rejects(translate(input), { code: "invalid_service_response", status: 502 });
});

test("network errors and timeouts have stable error codes", async t => {
  let failure = new TypeError("offline");
  t.mock.method(globalThis, "fetch", async () => { throw failure; });
  const translate = createHybridTranslator();
  await assert.rejects(translate(input), { code: "service_unavailable", status: 503 });
  failure = new DOMException("timeout", "TimeoutError");
  await assert.rejects(translate(input), { code: "service_timeout", status: 504 });
});
