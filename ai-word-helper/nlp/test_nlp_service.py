import unittest

from nlp_service import app, utf16_index


class NlpServiceTests(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.client = app.test_client()

    def test_invalid_inputs_return_json_400(self):
        for body in [{}, {"word": "", "sentence": "test"},
                     {"word": 1, "sentence": "test"},
                     {"word": "bank", "sentence": ""}]:
            with self.subTest(body=body):
                response = self.client.post("/analyze", json=body)
                self.assertEqual(response.status_code, 400)
                self.assertIn("error", response.get_json())

    def test_part_of_speech_depends_on_selected_occurrence(self):
        for start, part in [(2, "глагол"), (8, "существительное")]:
            with self.subTest(start=start):
                response = self.client.post("/analyze", json={
                    "word": "saw", "sentence": "I saw a saw.",
                    "selectionStart": start, "selectionEnd": start + 3,
                })
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.get_json()["partOfSpeech"], part)

    def test_adjective_uses_the_full_sentence(self):
        response = self.client.post("/analyze", json={
            "word": "light", "sentence": "This bag is light.",
            "selectionStart": 12, "selectionEnd": 17,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["partOfSpeech"], "прилагательное")

    def test_utf16_and_invalid_ranges(self):
        self.assertEqual(utf16_index("😀 saw", 3), 2)
        with self.assertRaises(ValueError):
            utf16_index("😀", 1)
        response = self.client.post("/analyze", json={
            "word": "saw", "sentence": "I saw a saw.",
            "selectionStart": 0, "selectionEnd": 3,
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.get_json())


if __name__ == "__main__":
    unittest.main()
