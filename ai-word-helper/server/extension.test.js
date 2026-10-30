import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");

function setup(text, { fetchImpl } = {}) {
  class Element {
    closest() { return false; }
  }
  const target = new Element();
  const textNode = { textContent: text };
  const listeners = {};
  const requests = [];
  const signals = [];
  const popups = [];
  const context = vm.createContext({
    HTMLElement: Element,
    NodeFilter: { SHOW_TEXT: 4 },
    Node: { TEXT_NODE: 3 },
    console,
    AbortController,
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
      signals.push(options.signal);
      if (fetchImpl) return fetchImpl(input, options);
      return { ok: true, json: async () => ({ ...input, translation: "берег" }) };
    },
    recordPopup: (...args) => popups.push(args)
  });
  vm.runInContext(source, context);
  // Observe rendering separately from the hit-testing and event behavior.
  vm.runInContext(`
    const fakePopup = () => ({ isConnected: true, remove() { this.isConnected = false; } });
    showLoadingPopup = (x, y, word) => { helperPopup = fakePopup(); recordPopup('loading', word); };
    showResultPopup = (x, y, data) => { helperPopup = fakePopup(); recordPopup('result', data.translation); };
    showErrorPopup = (x, y, message) => { helperPopup = fakePopup(); recordPopup('error', message); };
  `, context);
  return {
    target, requests, popups, listeners, signals,
    click: (offset, y = 30) => listeners.dblclick.handler({
      target, clientX: offset * 10 + 5, clientY: y, pageX: offset * 10 + 5, pageY: y
    })
  };
}

test("double click translates the word under the pointer even when selection is disabled", async () => {
  const page = setup("Hello! We sat on the bank of the river.");
  assert.equal(page.listeners.dblclick.capture, true);
  await page.click(21);
  assert.deepEqual(page.requests, [{ word: "bank", sentence: "We sat on the bank of the river.", mode: "quick", selectionStart: 14, selectionEnd: 18 }]);
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

function highlight(sentence, word, selectionStart, selectionEnd) {
  const context = vm.createContext({ document: { addEventListener() {} }, sentence, word, selectionStart, selectionEnd });
  vm.runInContext(source, context);
  return vm.runInContext("highlightWord(sentence, word, selectionStart, selectionEnd)", context);
}

test("card highlights whole words case-insensitively, including repeated words", () => {
  assert.equal(highlight("Create, create! Recreate.", "create"),
    "<mark>Create</mark>, <mark>create</mark>! Recreate.");
  assert.equal(highlight("I don’t know.", "don’t"), "I <mark>don’t</mark> know.");
});

test("card escapes HTML in both highlighted words and surrounding text", () => {
  assert.equal(highlight('<img src=x onerror="alert(1)"> create & run', "create"),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; <mark>create</mark> &amp; run');
  assert.equal(highlight("Use <b> here", "<b>"), "Use <mark>&lt;b&gt;</mark> here");
  assert.equal(highlight("Use a+b here", "a+b"), "Use <mark>a+b</mark> here");
});

function deferredPage() {
  const pending = [];
  // Deliberately ignore abort signals to simulate a response already in flight.
  const page = setup("bank light.", {
    fetchImpl: input => new Promise((resolve, reject) => pending.push({ input, resolve, reject }))
  });
  return { page, pending };
}

function resolveTranslation(request) {
  request.resolve({ ok: true, json: async () => ({ ...request.input, translation: request.input.word }) });
}

test("a late older response cannot overwrite a newer word", async () => {
  const { page, pending } = deferredPage();
  const old = page.click(1);
  const current = page.click(6);
  assert.equal(page.signals[0].aborted, true);
  resolveTranslation(pending[1]);
  await current;
  resolveTranslation(pending[0]);
  await old;
  assert.deepEqual(page.popups.filter(popup => popup[0] === "result"), [["result", "light"]]);
});

test("a late error from an older request cannot replace a newer result", async () => {
  const { page, pending } = deferredPage();
  const old = page.click(1);
  const current = page.click(6);
  resolveTranslation(pending[1]);
  await current;
  pending[0].reject(new Error("old request failed"));
  await old;
  assert.deepEqual(page.popups.filter(popup => popup[0] !== "loading"), [["result", "light"]]);
});

test("Escape prevents a pending response from reopening the popup", async () => {
  const { page, pending } = deferredPage();
  const request = page.click(1);
  page.listeners.keydown.handler({ key: "Escape" });
  assert.equal(page.signals[0].aborted, true);
  resolveTranslation(pending[0]);
  await request;
  assert.deepEqual(page.popups, [["loading", "bank"]]);
});

function textNode(text) { return { nodeType: 3, textContent: text }; }
function element(tagName, ...childNodes) {
  const node = { nodeType: 1, tagName, childNodes };
  for (const child of childNodes) child.parentElement = node;
  return node;
}
function contextFor(node, offset, length) {
  const context = vm.createContext({
    document: { addEventListener() {} }, window: {},
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 }, node, offset, length
  });
  vm.runInContext(source, context);
  return JSON.parse(vm.runInContext("JSON.stringify(getContextFromNode(node, offset, length))", context));
}

test("inline markup keeps the whole sentence and the selected word position", () => {
  const light = textNode("light");
  element("P", textNode("This bag is "), element("EM", light), textNode("."));
  assert.deepEqual(contextFor(light, 0, 5), {
    sentence: "This bag is light.", selectionStart: 12, selectionEnd: 17
  });
});

test("repeated words in separate inline elements preserve their own positions", () => {
  const first = textNode("saw");
  const second = textNode("saw");
  element("P", textNode("I "), element("EM", first), textNode(" a "), element("STRONG", second), textNode("."));
  assert.deepEqual(contextFor(first, 0, 3), { sentence: "I saw a saw.", selectionStart: 2, selectionEnd: 5 });
  assert.deepEqual(contextFor(second, 0, 3), { sentence: "I saw a saw.", selectionStart: 8, selectionEnd: 11 });
  assert.equal(highlight("I saw a saw.", "saw", 8, 11), "I saw a <mark>saw</mark>.");
});

test("context positions use UTF-16 even when inline text follows an emoji", () => {
  const saw = textNode("saw");
  element("P", textNode("😀 I saw a "), element("EM", saw), textNode("."));
  assert.deepEqual(contextFor(saw, 0, 3), { sentence: "😀 I saw a saw.", selectionStart: 11, selectionEnd: 14 });
});

test("context does not cross line breaks or nested block boundaries", () => {
  const light = textNode("light");
  element("DIV", element("P", textNode("Other text")), textNode("This bag is "), element("EM", light), textNode("."));
  assert.deepEqual(contextFor(light, 0, 5), { sentence: "This bag is light.", selectionStart: 12, selectionEnd: 17 });
  const bank = textNode("bank");
  element("P", textNode("Other text"), element("BR"), textNode("A "), bank, textNode("."));
  assert.deepEqual(contextFor(bank, 0, 4), { sentence: "A bank.", selectionStart: 2, selectionEnd: 6 });
});
