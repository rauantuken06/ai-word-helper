import os
import threading

import spacy
from flask import Flask, jsonify, request


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 32768
app.json.ensure_ascii = False

nlp = spacy.load("en_core_web_sm", disable=["ner"])
nlp_lock = threading.Lock()

PARTS = {
    "NOUN": "существительное",
    "PROPN": "имя собственное",
    "VERB": "глагол",
    "AUX": "вспомогательный глагол",
    "ADJ": "прилагательное",
    "ADV": "наречие",
    "PRON": "местоимение",
    "ADP": "предлог",
    "DET": "определитель",
    "CCONJ": "союз",
    "SCONJ": "подчинительный союз",
    "PART": "частица",
    "NUM": "числительное",
    "INTJ": "междометие",
}

def utf16_index(text, offset):
    if type(offset) is not int or offset < 0:
        raise ValueError("Некорректная позиция слова.")

    encoded = text.encode("utf-16-le")

    if offset * 2 > len(encoded):
        raise ValueError("Позиция находится за пределами предложения.")

    try:
        return len(encoded[:offset * 2].decode("utf-16-le"))
    except UnicodeDecodeError as error:
        raise ValueError("Некорректная граница символа.") from error

@app.get("/health")
def health():
    return jsonify(ok=True, model="en_core_web_sm")

@app.post("/analyze")
def analyze():
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify(error="Нужен JSON-объект."), 400

    word = data.get("word")
    sentence = data.get("sentence")

    if (
        not isinstance(word, str)
        or not word
        or len(word) > 100
        or not isinstance(sentence, str)
        or not sentence
        or len(sentence) > 4000
    ):
        return jsonify(error="Некорректное слово или предложение."), 400

    try:
        start =  utf16_index(sentence, data.get("selectionStart"))
        end = utf16_index(sentence, data.get("selectionEnd"))

        if end <= start or sentence[start:end] != word:
            raise ValueError("Выделенный текст не совпадает со словом.")
    except ValueError as error:
        return jsonify(error=str(error)), 400

    with nlp_lock:
        doc = nlp(sentence)
        span = doc.char_span(start, end, alignment_mode="expand")

        if span is None or len(span) == 0:
            return jsonify(error="Не удалось найти выбранное слово."), 400

        token = span.root

        return jsonify(
            partOfSpeech=PARTS.get(token.pos_, "не определено"),
            lemma=token.lemma_,
            morph=token.morph.to_dict(),
        )

if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=int(os.getenv("NLP_PORT", "5001")),
        debug=False,
    )
