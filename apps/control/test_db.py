import unittest

from db import qmark_to_percent, Row


class DbHelperTest(unittest.TestCase):
    def test_qmark(self):
        self.assertEqual(qmark_to_percent("SELECT * FROM t WHERE a=? AND b=?"), "SELECT * FROM t WHERE a=%s AND b=%s")

    def test_qmark_ignores_string_literal(self):
        self.assertEqual(
            qmark_to_percent("SELECT * FROM t WHERE a='x?' AND b=?"),
            "SELECT * FROM t WHERE a='x?' AND b=%s",
        )

    def test_row_dict_access(self):
        r = Row({"n": 3})
        self.assertEqual(r["n"], 3)


if __name__ == "__main__":
    unittest.main()
