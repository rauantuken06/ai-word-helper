let helperPopup = null;

document.addEventListener("dblclick", async (event) => {
    const target = event.target;

    if (target instanceof HTMLElement) {
        if (target.closest("input, textarea")) return;
        if (target.isContentEditable) return;
    }

    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim() : "";

    if (!selectedText) return;
    if (selectedText.split(/\s+/).length > 1) return;
    if (!/^[A-Za-z'-]+$/.test(selectedText)) return;

    const sentence = getSentenceFromSelection(selection);

    removePopup();
    showLoadingPopup(event.pageX, event.pageY, selectedText);

    try {
        const response = await fetch("http://localhost:3000/translate", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                word: selectedText,
                sentence
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server error: ${response.status} ${errorText}`);
        }

        const data = await response.json();

        removePopup();
        showResultPopup(event.pageX, event.pageY, data);
    } catch (error) {
        console.error(error);
        removePopup();
        showErrorPopup(event.pageX, event.pageY, "Не удалось получить перевод. Проверьте, запущен ли сервер.")
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") removePopup();
});

function getSentenceFromSelection(selection) {
    if (!selection || !selection.anchorNode) return "";

    const node = selection.anchorNode;
    if (node.nodeType !== Node.TEXT_NODE) return "";

    const text = node.textContent || "";
    const offset = selection.anchorOffset;

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
        <div class="title">${escapeHtml(word)}</div>
        <div class="muted">Перевожу...</div>
    `;
    document.body.appendChild(helperPopup);
    keepPopupInViewport(helperPopup);
}

function showResultPopup(x, y, data) {
    helperPopup = document.createElement("div");
    helperPopup.className = "ai-word-helper-popup";
    helperPopup.style.left = `${x + 10}px`;
    helperPopup.style.top = `${y + 10}px`;

    helperPopup.innerHTML = `
        <div class="title">${escapeHtml(data.word || "")}</div>
        <div><strong>Перевод:</strong> ${escapeHtml(data.translation || "")}</div>
        <div><strong>В этом контексте:</strong> ${escapeHtml(data.contextMeaning || "")}</div>
        <div><strong>Часть речи:</strong> ${escapeHtml(data.partOfSpeech || "")}</div>
        <div class="sentence">${escapeHtml(data.sentence || "")}</div>
        <div class="buttons">
            <button class="close-btn">Закрыть</button>
        </div>
    `;

    helperPopup.querySelector(".close-btn").addEventListener("click", removePopup);

    document.body.appendChild(helperPopup);
    keepPopupInViewport(helperPopup);
}

function showErrorPopup(x, y, message) {
    helperPopup = document.createElement("div");
    helperPopup.className = "ai-word-helper-popup";
    helperPopup.style.left = `${x + 10}px`;
    helperPopup.style.top = `${y + 10}px`;
    helperPopup.innerHTML = `
        <div class="error">${escapeHtml(message)}</div>
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