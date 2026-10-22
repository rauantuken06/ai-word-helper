let helperPopup = null;

document.addEventListener("dblclick", async (event) => {
    const target = event.target;

    if (target instanceof HTMLElement) {
        if (target.closest("input, textarea, .ai-word-helper-popup")) return;
        if (target.isContentEditable) return;
    }

    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim() : "";
    const pointedWord = getWordAtPoint(event);
    const word = pointedWord?.word || selectedText;

    if (!/^[A-Za-z]+(?:['’‘‐‑-][A-Za-z]+)*$/.test(word)) return;

    const sentence = pointedWord?.sentence || getSentenceFromSelection(selection) || word;

    removePopup();
    showLoadingPopup(event.pageX, event.pageY, word);

    try {
        const data = await fetchTranslation(word, sentence, "quick");

        removePopup();
        showResultPopup(event.pageX, event.pageY, data);
    } catch (error) {
        console.error(error);
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
                return { word: match[0], sentence: getSentenceAtOffset(text, match.index) };
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

    const text = node.textContent || "";
    return getSentenceAtOffset(text, selection.anchorOffset);
}

function getSentenceAtOffset(text, offset) {
    let start = offset;
    let end = offset;

    while (start > 0 && !/[.!?]/.test(text[start - 1])) start--;
    while (end < text.length && !/[.!?]/.test(text[end])) end++;

    return text.slice(start, Math.min(end + 1, text.length)).trim();
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

    const hasDetails = Boolean(
        data.contextMeaning && data.partOfSpeech
    );
    popup.classList.toggle("is-detailed", hasDetails);
    popup.setAttribute("role", "region");
    popup.setAttribute("aria-label", `Перевод слова ${data.word || ""}`);

    popup.innerHTML = `
        <div class="card-header">
            <div class="word-tags">
                <span class="title word-badge" lang="en">${escapeHtml(data.word || "")}</span>
                ${hasDetails ? `<span class="part-of-speech">${escapeHtml(data.partOfSpeech)}</span>` : ""}
            </div>
            <button type="button" class="speak-btn" aria-label="Произнести слово" title="Произнести слово">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M16 9a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12"/>
                </svg>
            </button>
        </div>

        <div class="translation" lang="ru">${escapeHtml(data.translation || "")}</div>

        ${hasDetails ? `
        <div class="context-meaning">
            <strong>В этом контексте:</strong>
            ${escapeHtml(data.contextMeaning)}
        </div>
        ` : ""}

        ${data.sentence ? `<div class="sentence" lang="en">${highlightWord(data.sentence, data.word)}</div>` : ""}

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

        try {
            const details = await fetchTranslation(
            data.word,
            data.sentence,
            "full"
            );

            // Не заменяем окно другого слова или уже закрытое окно.
            if (helperPopup !== popup || !popup.isConnected) return;

            removePopup();
            showResultPopup(x, y, details);
        } catch (error) {
            if (helperPopup !== popup || !popup.isConnected) return;

            popup.querySelector(".details-error").textContent =
            error.message || "Не удалось загрузить объяснение.";

            detailsButton.disabled = false;
            detailsButton.textContent = "Повторить";
            keepPopupInViewport(popup);
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

function highlightWord(sentence, word) {
    if (!word) return escapeHtml(sentence);
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

async function fetchTranslation(word, sentence, mode) {
    const response = await fetch("http://localhost:3000/translate", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ word, sentence, mode })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.details || "Не удалось получить перевод.");
    }

    return data;
}
