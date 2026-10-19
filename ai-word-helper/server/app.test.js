import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "./app.js";
import { createTranslator } from "./translator.js";

test("HTTP translation contract and failure responses without an API key", async t => {
  let upstreamStatus = 200;
  let calls = 0;
  const answer = { translation: "берег", contextMeaning: "Берег реки", partOfSpeech: "существительное" };
  const translate = createTranslator({ fetchImpl: async () => {
    calls++;
    return Response.json({ message: { content: JSON.stringify(answer) } }, { status: upstreamStatus });
  }});
  const server = createApp({ translate, model: "gemma3:4b" }).listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(`${base}/translate`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });

  await t.test("liveness does not call the model", async () => {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).provider, "ollama");
    assert.equal(calls, 0);
  });
  await t.test("returns the fields expected by the extension", async () => {
    const input = { word: "bank", sentence: "We sat on the bank of the river." };
    const response = await post(input);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ...input, ...answer });
  });
  await t.test("invalid inputs never reach the model", async () => {
    const before = calls;
    for (const body of [{}, { word: 1, sentence: "test" }, { word: "bank", sentence: " " },
      { word: "x".repeat(101), sentence: "test" }, { word: "bank", sentence: "x".repeat(4001) }]) {
      const response = await post(body);
      assert.equal(response.status, 400);
      await response.json();
    }
    assert.equal(calls, before);
  });
  await t.test("rejects malformed JSON and oversized bodies", async () => {
    for (const [body, status] of [["{", 400], [JSON.stringify({ word: "x".repeat(17000) }), 413]]) {
      const response = await fetch(`${base}/translate`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body
      });
      assert.equal(response.status, status);
      assert.equal((await response.json()).error, "bad_request");
    }
  });
  await t.test("passes actionable missing-model errors to the extension", async () => {
    upstreamStatus = 404;
    const response = await post({ word: "bank", sentence: "A river bank." });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, "model_not_found");
    assert.match(body.details, /ollama pull gemma3:4b/);
  });
});
