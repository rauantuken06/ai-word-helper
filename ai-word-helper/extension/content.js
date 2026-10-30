let helperPopup = null;
let popupGeneration = 0;
let activeRequest = null;

document.addEventListener("dblclick", async (event) => {
    const target = event.target;

    if (target instanceof HTMLElement) {
        if (target.closest("input, textarea, .ai-word-helper-popup")) return;
        if (target.isContentEditable) return;
    }

    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim() : "";
    const pointedWord = getWordAtPoint(event);
    const selectedWord = pointedWord || getWordFromSelection(selection, selectedText);
    const word = selectedWord?.word || selectedText;

    if (!/^[A-Za-z]+(?:['’‘‐‑-][A-Za-z]+)*$/.test(word)) return;

    const sentence = selectedWord?.sentence || getSentenceFromSelection(selection) || word;

    removePopup();
    const generation = popupGeneration;
    const controller = new AbortController();
    activeRequest = controller;
    showLoadingPopup(event.pageX, event.pageY, word);

    try {
        const data = await fetchTranslation(
            word,
            sentence,
            "quick",
            selectedWord || {},
            controller.signal
        );

        if (generation !== popupGeneration) return;
        activeRequest = null;
        removePopup();
        showResultPopup(event.pageX, event.pageY, data);
    } catch (error) {
        if (generation !== popupGeneration || error.name === "AbortError") return;
        console.error(error);
        activeRequest = null;
        removePopup();
        showErrorPopup(event.pageX, event.pageY, error instanceof TypeError
            ? "Не удалось подключиться к серверу. Запустите сервер командой npm start."
            : error.message);
    }
}, true);

// Some readers disable text selection. Locate the rendered word independently
// of window.getSelection(), using viewport coordinates for the hit test.
function getWordAtPoint(event) {
    if (!(event.target instanceof HTMLElement)) return null;
    const walker = document.createTreeWalker(event.target, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let node;
    while ((node = walker.nextNode())) {
        const text = node.textContent || "";
        for (const match of text.matchAll(/[A-Za-z]+(?:['’‘‐‑-][A-Za-z]+)*/g)) {
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            const hit = Array.from(range.getClientRects()).some(rect =>
                rect.width > 0 && rect.height > 0 &&
                event.clientX >= rect.left && event.clientX <= rect.right &&
                event.clientY >= rect.top && event.clientY <= rect.bottom);
            if (hit) {
                return {
                    word: match[0],
                    ...getContextFromNode(
                        node,
                        match.index,
                        match[0].length
                    )
                };
            }
        }
    }
    return null;
}

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") removePopup();
});

function getSentenceFromSelection(selection) {
    if (!selection || !selection.anchorNode) return "";

    const node = selection.anchorNode;
    if (node.nodeType !== Node.TEXT_NODE) return "";

    return getContextFromNode(node, selection.anchorOffset, 0).sentence;
}

function getWordFromSelection(selection, word) {
    if (!selection?.rangeCount || !word) return null;
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return null;
    const selected = selection.toString();
    const offset = range.startOffset + selected.length - selected.trimStart().length;
    if ((node.textContent || "").slice(offset, offset + word.length) !== word) return null;
    return { word, ...getContextFromNode(node, offset, word.length) };
}

function getContextFromNode(node, offset, length) {
    // Collect the containing text block, preserving inline markup and node
    // boundaries in one coordinate system shared with the backend.
    const blockTags = /^(P|DIV|LI|BLOCKQUOTE|PRE|TD|TH|H[1-6]|FIGCAPTION|DT|DD|ARTICLE|SECTION|MAIN|BODY)$/;
    let root = node.parentElement;
    while (root?.parentElement && !blockTags.test(root.tagName)) root = root.parentElement;
    if (!root) return getContextAtOffset(node.textContent || "", offset, length);

    let text = "";
    let nodeStart = null;
    function collect(current) {
        if (current.nodeType === Node.TEXT_NODE) {
            if (current === node) nodeStart = text.length;
            text += current.textContent || "";
            return;
        }
        if (current.nodeType !== Node.ELEMENT_NODE) return;
        if (/^(SCRIPT|STYLE|NOSCRIPT|INPUT|TEXTAREA|BUTTON)$/.test(current.tagName) || current.hidden) return;
        if (typeof window.getComputedStyle === "function") {
            const style = window.getComputedStyle(current);
            if (style.display === "none" || style.visibility === "hidden") return;
        }
        if (current.tagName === "BR") {
            text += "\n";
            return;
        }
        const boundary = current !== root && blockTags.test(current.tagName);
        if (boundary) text += "\n";
        for (const child of current.childNodes) collect(child);
        if (boundary) text += "\n";
    }
    collect(root);
    return nodeStart === null
        ? getContextAtOffset(node.textContent || "", offset, length)
        : getContextAtOffset(text, nodeStart + offset, length);
}

function showLoadingPopup(x, y, word) {
    helperPopup = document.createElement("div");
    helperPopup.className = "ai-word-helper-popup";
    helperPopup.style.left = `${x + 10}px`;
    helperPopup.style.top = `${y + 10}px`;
    helperPopup.innerHTML = `
        <div class="title word-badge">${escapeHtml(word)}</div>
        <div class="muted" role="status">Перевожу…</div>
    `;
    document.body.appendChild(helperPopup);
    keepPopupInViewport(helperPopup);
}

function showResultPopup(x, y, data) {
    const popup = document.createElement("div");
    helperPopup = popup;

    popup.className = "ai-word-helper-popup";
    popup.style.left = `${x + 10}px`;
    popup.style.top = `${y + 10}px`;

    const hasDetails = Boolean(data.contextMeaning);
    popup.classList.toggle("is-detailed", hasDetails);
    popup.setAttribute("role", "region");
    popup.setAttribute("aria-label", `Перевод слова ${data.word || ""}`);

    popup.innerHTML = `
        <div class="card-header">
            <div class="word-tags">
                <span class="title word-badge" lang="en">${escapeHtml(data.word || "")}</span>
                ${data.partOfSpeech ? `<span class="part-of-speech">${escapeHtml(data.partOfSpeech)}</span>` : ""}
            </div>
            <button type="button" class="speak-btn" aria-label="Произнести слово" title="Произнести слово">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M16 9a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12"/>
                </svg>
            </button>
        </div>

        <div class="muted">
            ${data.translationKind === "standalone"
                ? "Вариант перевода слова"
                : "Перевод в контексте"}
        </div>

        <div class="translation" lang="ru">${escapeHtml(data.translation || "")}</div>

        ${hasDetails ? `
        <div class="context-meaning">
            <strong>В этом контексте:</strong>
            ${escapeHtml(data.contextMeaning)}
        </div>
        ` : ""}

        ${data.sentence ? `<div class="sentence" lang="en">${highlightWord(data.sentence, data.word, data.selectionStart, data.selectionEnd)}</div>` : ""}

        ${data.sentenceTranslation ? `
            <div class="sentence" lang="ru">
                <strong>Перевод предложения:</strong>
                ${escapeHtml(data.sentenceTranslation)}
            </div>
        ` : ""}

        <div class="details-error error" role="status" aria-live="polite"></div>

        <div class="buttons">
        ${hasDetails ? "" : `
            <button class="details-btn">Подробнее</button>
        `}
        <button class="close-btn">Закрыть</button>
        </div>
    `;

    popup.querySelector(".close-btn")
        .addEventListener("click", removePopup);

    const speakButton = popup.querySelector(".speak-btn");
    if ("speechSynthesis" in window && "SpeechSynthesisUtterance" in window) {
        speakButton.addEventListener("click", () => {
            const utterance = new window.SpeechSynthesisUtterance(data.word || "");
            utterance.lang = "en-US";
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(utterance);
        });
    } else {
        speakButton.disabled = true;
        speakButton.title = "Озвучивание недоступно в этом браузере";
    }

    const detailsButton = popup.querySelector(".details-btn");

    if (detailsButton) {
        detailsButton.addEventListener("click", async () => {
        detailsButton.disabled = true;
        detailsButton.textContent = "Загружаю…";
        popup.querySelector(".details-error").textContent = "";
        const generation = popupGeneration;
        const controller = new AbortController();
        activeRequest = controller;

        try {
            const details = await fetchTranslation(
            data.word,
            data.sentence,
            "full",
            data,
            controller.signal
            );

            // Не заменяем окно другого слова или уже закрытое окно.
            if (generation !== popupGeneration || helperPopup !== popup || !popup.isConnected) return;

            activeRequest = null;
            removePopup();
            showResultPopup(x, y, {
                ...data,
                ...details,
                partOfSpeech: data.partOfSpeech || details.partOfSpeech
            });
        } catch (error) {
            if (generation !== popupGeneration || helperPopup !== popup || !popup.isConnected || error.name === "AbortError") return;

            popup.querySelector(".details-error").textContent =
            error.message || "Не удалось загрузить объяснение.";

            detailsButton.disabled = false;
            detailsButton.textContent = "Повторить";
            keepPopupInViewport(popup);
        } finally {
            if (activeRequest === controller) activeRequest = null;
        }
        });
    }

    document.body.appendChild(popup);
    keepPopupInViewport(popup);
}

function showErrorPopup(x, y, message) {
    helperPopup = document.createElement("div");
    helperPopup.className = "ai-word-helper-popup";
    helperPopup.style.left = `${x + 10}px`;
    helperPopup.style.top = `${y + 10}px`;
    helperPopup.innerHTML = `
        <div class="word-badge">Ошибка перевода</div>
        <div class="error" role="alert">${escapeHtml(message)}</div>
        <div class="buttons">
            <button class="close-btn">Закрыть</button>
        </div>
    `;
    helperPopup.querySelector(".close-btn").addEventListener("click", removePopup);
    document.body.appendChild(helperPopup);
    keepPopupInViewport(helperPopup);
}

function removePopup() {
    popupGeneration++;
    activeRequest?.abort();
    activeRequest = null;
    if (helperPopup) {
        helperPopup.remove();
        helperPopup = null;
    }
}

function keepPopupInViewport(element) {
    const rect = element.getBoundingClientRect();

    let left = rect.left;
    let top = rect.top;

    const maxLeft = window.innerWidth - rect.width - 10;
    const maxTop = window.innerHeight - rect.height - 10;

    if (left > maxLeft) left = Math.max(10, maxLeft);
    if (top > maxTop) top = Math.max(10, maxTop);

    element.style.left = `${left + window.scrollX}px`;
    element.style.top = `${top + window.scrollY}px`;
}

function escapeHtml(str) {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;")
}

function highlightWord(sentence, word, selectionStart, selectionEnd) {
    if (!word) return escapeHtml(sentence);
    if (Number.isInteger(selectionStart) && Number.isInteger(selectionEnd) &&
        selectionStart >= 0 && selectionEnd > selectionStart && selectionEnd <= sentence.length &&
        sentence.slice(selectionStart, selectionEnd) === word) {
        return escapeHtml(sentence.slice(0, selectionStart)) +
            `<mark>${escapeHtml(sentence.slice(selectionStart, selectionEnd))}</mark>` +
            escapeHtml(sentence.slice(selectionEnd));
    }
    const escapedWord = String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|[^A-Za-z’‘'‐‑-])(${escapedWord})(?=$|[^A-Za-z’‘'‐‑-])`, "gi");
    let result = "";
    let offset = 0;
    for (const match of String(sentence).matchAll(pattern)) {
        const start = match.index + match[1].length;
        result += escapeHtml(sentence.slice(offset, start));
        result += `<mark>${escapeHtml(match[2])}</mark>`;
        offset = start + match[2].length;
    }
    return result + escapeHtml(sentence.slice(offset));
}

async function fetchTranslation(
  word,
  sentence,
  mode,
  { selectionStart, selectionEnd } = {},
  signal
) {
  const response = await fetch(
    "http://localhost:3000/translate",
    {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        word,
        sentence,
        mode,
        selectionStart,
        selectionEnd
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.details || "Не удалось получить перевод."
    );
  }

  return data;
}

function getContextAtOffset(text, offset, length) {
  let start = offset;
  let end = offset;

  while (start > 0 && !/[.!?\r\n]/.test(text[start - 1])) start--;
  while (end < text.length && !/[.!?\r\n]/.test(text[end])) end++;

  const raw = text.slice(
    start,
    Math.min(end + 1, text.length)
  );

  const leading = raw.length - raw.trimStart().length;
  const selectionStart = offset - start - leading;

  return {
    sentence: raw.trim(),
    selectionStart,
    selectionEnd: selectionStart + length
  };
}
