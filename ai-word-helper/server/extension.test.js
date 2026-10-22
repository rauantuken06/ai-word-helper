import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");

function setup(text) {
  class Element {
    closest() { return false; }
  }
  const target = new Element();
  const textNode = { textContent: text };
  const listeners = {};
  const requests = [];
  const popups = [];
  const context = vm.createContext({
    HTMLElement: Element,
    NodeFilter: { SHOW_TEXT: 4 },
    Node: { TEXT_NODE: 3 },
    console,
    window: { getSelection: () => null },
    document: {
      addEventListener: (name, handler, capture) => { listeners[name] = { handler, capture }; },
      createTreeWalker: () => {
        let visited = false;
        return { nextNode: () => visited ? null : (visited = true, textNode) };
      },
      createRange: () => {
        let start, end;
        return {
          setStart: (node, offset) => { start = offset; },
          setEnd: (node, offset) => { end = offset; },
          // Simulate a line with 10px character cells at y=20..40.
          getClientRects: () => [{ left: start * 10, right: end * 10,
            top: 20, bottom: 40, width: (end - start) * 10, height: 20 }]
        };
      }
    },
    fetch: async (url, options) => {
      assert.equal(options.headers?.["Content-Type"], "application/json");
      const input = JSON.parse(options.body);
      requests.push(input);
      return { ok: true, json: async () => ({ ...input, translation: "берег" }) };
    },
    recordPopup: (...args) => popups.push(args)
  });
  vm.runInContext(source, context);
  // Observe rendering separately from the hit-testing and event behavior.
  vm.runInContext(`
    removePopup = () => {};
    showLoadingPopup = (x, y, word) => recordPopup('loading', word);
    showResultPopup = (x, y, data) => recordPopup('result', data.translation);
    showErrorPopup = (x, y, message) => recordPopup('error', message);
  `, context);
  return {
    target, requests, popups, listeners,
    click: (offset, y = 30) => listeners.dblclick.handler({
      target, clientX: offset * 10 + 5, clientY: y, pageX: offset * 10 + 5, pageY: y
    })
  };
}

test("double click translates the word under the pointer even when selection is disabled", async () => {
  const page = setup("Hello! We sat on the bank of the river.");
  assert.equal(page.listeners.dblclick.capture, true);
  await page.click(21);
  assert.deepEqual(page.requests, [{ word: "bank", sentence: "We sat on the bank of the river.", mode: "quick" }]);
  assert.deepEqual(page.popups, [["loading", "bank"], ["result", "берег"]]);
});

test("supports typographic apostrophes in reader text", async () => {
  const page = setup("I don’t know.");
  await page.click(4);
  assert.equal(page.requests[0].word, "don’t");
});

test("clicking outside text does not send a translation request", async () => {
  const page = setup("Hello world.");
  await page.click(3, 100);
  assert.equal(page.requests.length, 0);
});

test("editable text does not trigger translation", async () => {
  const page = setup("Hello world.");
  page.target.isContentEditable = true;
  await page.click(3);
  assert.equal(page.requests.length, 0);
});
