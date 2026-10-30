import { TranslationError } from "./translator.js";

function localEndpoint(base, path) {
    const url = new URL(base.replace(/\/+$/, "") + path);

    if (
        url.protocol !== "http:" ||
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    ) {
        throw new Error("Сервисы перевода должны использовать локальный HTTP.");
    }

    return url;
}

export function normalizeSelection({
    word,
    sentence,
    selectionStart,
    selectionEnd
}) {
    if (selectionStart === undefined && selectionEnd === undefined) {
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const pattern = new RegExp(
            `(^|[^A-Za-z'’‘‐‑-])(${escaped})(?=$|[^A-Za-z'’‘‐‑-])`,
            "g"
        );

        const matches = [...sentence.matchAll(pattern)];

        if (matches.length !== 1) {
            throw new TranslationError(
                "bad_request",
                400,
                "Не удалось определить выбранное вхождение слова. Обновите расширение."
            );
        }

        selectionStart = matches[0].index + matches[0][1].length;
        selectionEnd = selectionStart + word.length;
    }

    if (
        !Number.isInteger(selectionStart) ||
        !Number.isInteger(selectionEnd) ||
        selectionStart < 0 ||
        selectionEnd <= selectionStart ||
        selectionEnd > sentence.length ||
        sentence.slice(selectionStart, selectionEnd) !== word
    ) {
        throw new TranslationError(
            "bad_request",
            400,
            "Позиция выбранного слова не соответствует предложению."
        );
    }

    return { selectionStart, selectionEnd };
}

export function createHybridTranslator({
    libreUrl = "http://127.0.0.1:5000",
    nlpUrl = "http://127.0.0.1:5001",
    explain,
    timeoutMs = 60000
} = {}) {
    if (
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 2147483647
    ) {
        throw new Error("Некорректное значение SERVICE_TIMEOUT_MS.");
    }

    const translateUrl = localEndpoint(libreUrl, "/translate");
    const analyzeUrl = localEndpoint(nlpUrl, "/analyze");

    async function post(url, body, signal, service) {
        try {
            const response = await fetch(url, {
                method: "POST",
                redirect: "error",
                signal,
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                throw new TranslationError(
                    "service_failed",
                    503,
                    `${service}: ошибка ${response.status}. Проверьте его терминал.`
                );
            }

            return await response.json();
        } catch (error) {
            if (error instanceof TranslationError) throw error;

            if (
                error.name === "TimeoutError" ||
                error.name === "AbortError"
            ) {
                throw new TranslationError(
                    "service_timeout",
                    504,
                    `${service} не успел ответить.`
                );
            }

            if (error instanceof SyntaxError) {
                throw new TranslationError(
                    "invalid_service_response",
                    502,
                    `${service} вернул некорректный JSON.`
                );
            }

            throw new TranslationError(
                "service_unavailable",
                503,
                `Нет соединения с ${service}. Запустите этот сервис.`
            );
        }
    }

    return async function translate(input) {
        const { word, sentence, mode = "full" } = input;
        const selection = normalizeSelection(input);

        if (mode === "full") {
            if (!explain) {
                throw new TranslationError(
                    "explanation_disabled",
                    503,
                    "Объяснение выключено. Нужны AI_ENABLED=true и работающая Ollama."
                );
            }

            const details = await explain({
                ...input,
                ...selection,
                mode: "full"
            });

            return {
                ...details,
                ...selection,
                translationKind: "contextual"
            };
        }

        const signal = AbortSignal.timeout(timeoutMs);

        const [translated, grammar] = await Promise.all([
            post(
                translateUrl,
                {
                    q: [word, sentence],
                    source: "en",
                    target: "ru",
                    format: "text"
                },
                signal,
                "LibreTranslate"
            ),

            post(
                analyzeUrl,
                { word, sentence, ...selection },
                signal,
                "spaCy"
            )
        ]);

        const texts = translated?.translatedText;

        if (
            !Array.isArray(texts) ||
            texts.length !== 2 ||
            texts.some(text => typeof text !== "string" || !text.trim()) ||
            typeof grammar?.partOfSpeech !== "string" ||
            !grammar.partOfSpeech.trim()
        ) {
            throw new TranslationError(
                "invalid_service_response",
                502,
                "Сервисы вернули неполный ответ."
            );
        }

        return {
            word,
            sentence,
            ...selection,
            translation: texts[0].trim(),
            sentenceTranslation: texts[1].trim(),
            partOfSpeech: grammar.partOfSpeech,
            lemma: grammar.lemma || "",
            contextMeaning: "",
            translationKind: "standalone"
        };
    };
}
