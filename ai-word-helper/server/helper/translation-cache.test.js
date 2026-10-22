import test from "node:test";
import assert from "node:assert/strict";
import { withTranslationCache } from "./translation-cache.js";

const input = { word: "bank", sentence: "We sat on the bank of the river." };

test("quick and full answers use separate cache entries", async () => {
  let calls = 0;
  const translate = withTranslationCache(async value => { calls++; return { mode: value.mode || "full" }; });
  assert.deepEqual(await translate({ ...input, mode: "quick" }), { mode: "quick" });
  assert.deepEqual(await translate(input), { mode: "full" });
  assert.deepEqual(await translate({ ...input, mode: "full" }), { mode: "full" });
  assert.equal(calls, 2);
});

test("repeated translations use the cached answer", async () => {
  let calls = 0;
  const translate = withTranslationCache(async () => {
    calls++;
    return { translation: "берег" };
  });
  const answer = await translate(input);
  assert.deepEqual(await translate({ ...input }), answer);
  assert.equal(calls, 1);
});

test("simultaneous identical translations share one generation", async () => {
  let calls = 0;
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const translate = withTranslationCache(async () => { calls++; return pending; });
  const first = translate(input);
  const second = translate({ ...input });
  complete({ translation: "берег" });
  const answers = await Promise.all([first, second]);
  assert.deepEqual(answers[0], answers[1]);
  assert.equal(calls, 1);
});

test("the same word in different sentences is translated separately", async () => {
  let calls = 0;
  const translate = withTranslationCache(async value => { calls++; return value; });
  await translate(input);
  await translate({ word: "bank", sentence: "I deposited money at the bank." });
  assert.equal(calls, 2);
});

test("failed translations can be retried", async () => {
  let calls = 0;
  const translate = withTranslationCache(async () => {
    if (++calls === 1) throw new Error("temporary failure");
    return { translation: "берег" };
  });
  await assert.rejects(translate(input), /temporary failure/);
  assert.deepEqual(await translate(input), { translation: "берег" });
  assert.equal(calls, 2);
});
