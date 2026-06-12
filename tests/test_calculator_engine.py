import math
import unittest

from calculator_engine import CalculationError, calculate, format_result


class CalculatorEngineTests(unittest.TestCase):
    def test_operator_precedence_and_brackets(self):
        self.assertEqual(calculate("2 + 3 * (4 - 1)"), 11)

    def test_percent_and_modulo_are_distinct(self):
        self.assertEqual(calculate("200 * 10%"), 20)
        self.assertEqual(calculate("17 mod 5"), 2)

    def test_scientific_functions_and_angle_modes(self):
        self.assertAlmostEqual(calculate("sin(30)", "deg"), 0.5, places=12)
        self.assertAlmostEqual(calculate("sin(pi / 2)", "rad"), 1, places=12)
        self.assertAlmostEqual(calculate("asin(0.5)", "deg"), 30, places=12)

    def test_roots_powers_factorial_and_notation(self):
        self.assertEqual(calculate("root(32, 5)"), 2)
        self.assertAlmostEqual(calculate("cbrt(-27)"), -3, places=12)
        self.assertEqual(calculate("5! + 2^3"), 128)
        self.assertEqual(calculate("1.2e3 + 4"), 1204)

    def test_constants_and_logs(self):
        self.assertAlmostEqual(calculate("ln(e)"), 1, places=12)
        self.assertAlmostEqual(calculate("log10(1000)"), 3, places=12)
        self.assertAlmostEqual(calculate("pi"), math.pi, places=12)

    def test_invalid_and_dangerous_inputs_are_rejected(self):
        for expression in ("1 / 0", "(-1)!", "171!", "__import__(1)", "sqrt(-1)"):
            with self.subTest(expression=expression):
                with self.assertRaises(CalculationError):
                    calculate(expression)

    def test_result_formatting(self):
        self.assertEqual(format_result(350), "350")
        self.assertIn("e", format_result(1.23e20))


if __name__ == "__main__":
    unittest.main()
