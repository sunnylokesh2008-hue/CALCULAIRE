import math
import re


class CalculationError(ValueError):
    pass


class CalculatorParser:
    MAX_EXPRESSION_LENGTH = 220
    MAX_FACTORIAL = 170
    MAX_POWER = 10000

    def __init__(self, expression, angle="deg"):
        if not isinstance(expression, str) or not expression.strip():
            raise CalculationError("Enter an expression.")
        if len(expression) > self.MAX_EXPRESSION_LENGTH:
            raise CalculationError("Expression is too long.")

        normalized = (
            expression.strip()
            .replace("×", "*")
            .replace("÷", "/")
            .replace("−", "-")
            .replace("π", "pi")
            .replace("√", "sqrt")
            .replace("^", "^")
        )
        self.tokens = self._tokenize(normalized)
        self.index = 0
        self.angle = angle if angle in {"deg", "rad"} else "deg"

    @staticmethod
    def _tokenize(expression):
        token_pattern = re.compile(
            r"\s*(?:(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+)?|([A-Za-z_][A-Za-z_0-9]*)|(.))"
        )
        tokens = []
        position = 0
        while position < len(expression):
            match = token_pattern.match(expression, position)
            if not match:
                raise CalculationError("Expression contains an invalid character.")
            number, exponent, identifier, operator = match.groups()
            position = match.end()
            if number:
                tokens.append(("number", number + (exponent or "")))
            elif identifier:
                tokens.append(("identifier", identifier.lower()))
            elif operator in "+-*/^!%(),":
                tokens.append((operator, operator))
            else:
                raise CalculationError(f"Unsupported character: {operator}")
        tokens.append(("eof", ""))
        return tokens

    def parse(self):
        value = self._expression()
        if self._peek()[0] != "eof":
            raise CalculationError("Check the expression syntax.")
        if not math.isfinite(value):
            raise CalculationError("Result is not finite.")
        return value

    def _peek(self):
        return self.tokens[self.index]

    def _accept(self, kind):
        if self._peek()[0] == kind:
            token = self._peek()
            self.index += 1
            return token
        return None

    def _expect(self, kind):
        token = self._accept(kind)
        if not token:
            raise CalculationError("Check brackets and function arguments.")
        return token

    def _expression(self):
        value = self._term()
        while self._peek()[0] in {"+", "-"}:
            operator = self._peek()[0]
            self.index += 1
            right = self._term()
            value = value + right if operator == "+" else value - right
        return value

    def _term(self):
        value = self._unary()
        while self._peek()[0] in {"*", "/"} or (
            self._peek()[0] == "identifier" and self._peek()[1] == "mod"
        ):
            operator = self._peek()[1]
            self.index += 1
            right = self._unary()
            if operator == "*":
                value *= right
            elif operator == "/":
                if right == 0:
                    raise CalculationError("Cannot divide by zero.")
                value /= right
            else:
                if right == 0:
                    raise CalculationError("Cannot calculate modulo zero.")
                value %= right
        return value

    def _unary(self):
        if self._accept("+"):
            return self._unary()
        if self._accept("-"):
            return -self._unary()
        return self._power()

    def _power(self):
        value = self._postfix()
        if self._accept("^"):
            exponent = self._unary()
            if abs(exponent) > self.MAX_POWER:
                raise CalculationError("Exponent is too large.")
            try:
                value = value ** exponent
            except (OverflowError, ZeroDivisionError, ValueError):
                raise CalculationError("Power is outside the supported range.")
            if isinstance(value, complex):
                raise CalculationError("Complex results are not supported.")
        return value

    def _postfix(self):
        value = self._primary()
        while self._peek()[0] in {"!", "%"}:
            operator = self._peek()[0]
            self.index += 1
            if operator == "%":
                value /= 100
            else:
                if value < 0 or not float(value).is_integer():
                    raise CalculationError("Factorial requires a non-negative integer.")
                if value > self.MAX_FACTORIAL:
                    raise CalculationError("Factorial input is too large.")
                value = float(math.factorial(int(value)))
        return value

    def _primary(self):
        number = self._accept("number")
        if number:
            return float(number[1])

        if self._accept("("):
            value = self._expression()
            self._expect(")")
            return value

        identifier = self._accept("identifier")
        if not identifier:
            raise CalculationError("Expected a number, constant, or function.")

        name = identifier[1]
        constants = {"pi": math.pi, "e": math.e}
        if name in constants and self._peek()[0] != "(":
            return constants[name]

        self._expect("(")
        arguments = []
        if self._peek()[0] != ")":
            arguments.append(self._expression())
            while self._accept(","):
                arguments.append(self._expression())
        self._expect(")")
        return self._call(name, arguments)

    def _call(self, name, arguments):
        def require(count):
            if len(arguments) != count:
                raise CalculationError(f"{name} expects {count} argument(s).")

        to_rad = lambda value: math.radians(value) if self.angle == "deg" else value
        from_rad = lambda value: math.degrees(value) if self.angle == "deg" else value

        try:
            if name in {"sin", "cos", "tan"}:
                require(1)
                return getattr(math, name)(to_rad(arguments[0]))
            if name in {"asin", "acos", "atan"}:
                require(1)
                return from_rad(getattr(math, name)(arguments[0]))
            if name in {"sinh", "cosh", "tanh", "sqrt", "exp"}:
                require(1)
                return getattr(math, name)(arguments[0])
            if name in {"ln", "log"}:
                require(1)
                return math.log(arguments[0])
            if name == "log10":
                require(1)
                return math.log10(arguments[0])
            if name == "cbrt":
                require(1)
                return math.copysign(abs(arguments[0]) ** (1 / 3), arguments[0])
            if name in {"root", "nthroot"}:
                require(2)
                value, degree = arguments
                if degree == 0:
                    raise CalculationError("Root degree cannot be zero.")
                if value < 0 and float(degree).is_integer() and int(degree) % 2:
                    return -((-value) ** (1 / degree))
                result = value ** (1 / degree)
                if isinstance(result, complex):
                    raise CalculationError("Complex results are not supported.")
                return result
        except (ValueError, OverflowError, ZeroDivisionError):
            raise CalculationError(f"{name} is outside its valid domain.")

        raise CalculationError(f"Unknown function: {name}")


def calculate(expression, angle="deg"):
    return CalculatorParser(expression, angle).parse()


def format_result(value):
    if not math.isfinite(value):
        raise CalculationError("Result is not finite.")
    if value == 0:
        return "0"
    if abs(value) >= 1e12 or abs(value) < 1e-9:
        return f"{value:.10e}".replace("e+", "e")
    rounded = f"{value:.13g}"
    return rounded


def build_insight(expression, result, mode, angle):
    return {
        "answer": format_result(result),
        "formula": expression,
        "explanation": "Evaluated by the CALCULAIRE safe scientific engine with standard precedence.",
        "steps": [
            f"Input parsed in {mode} mode",
            f"Angle system: {angle.upper()}",
            f"Verified result: {format_result(result)}",
        ],
    }
