"""The small, safe expression language question patterns are written in
(#166, 27 Oct 2026; PHASE5_MOCK_PAPER_DESIGN.md).

A pattern says how its numbers relate ("n rounded to the nearest 100",
"speed x hours", "a fourth of the group") as short expressions. They are
stored in the database, so they are never run as Python: each one is parsed
into a syntax tree and walked here, and anything not on a short list is
refused when the pattern is loaded, not when a paper is made.

Allowed: whole numbers and exact fractions (Fraction, never float), text in
quotes, True/False, the names of the pattern's own values, a key of a
value that is a record (`name.he`, `mode.lo`), + - * / // % and ** (small
powers), comparisons, and/or/not, `x if c else y`, and the functions in
FUNCTIONS. "/" always gives an exact fraction, so 7 / 2 is 7/2, not 3.5.

Not allowed: calls to anything else, attribute access on anything but a
record's own keys (no names starting with "_"), indexing, comprehensions,
lambdas, assignments, floats. An expression is at most 300 characters.
"""
from __future__ import annotations

import ast
import math
from fractions import Fraction

MAX_LENGTH = 300
MAX_POWER = 12
MAX_MAGNITUDE = 10**15


class ExprError(Exception):
    """An expression that is not allowed, or cannot be worked out."""


def _num(value):
    if isinstance(value, bool) or not isinstance(value, (int, Fraction)):
        raise ExprError(f"{value!r} is not a number.")
    return value


def _whole(value) -> int:
    value = _num(value)
    if isinstance(value, Fraction):
        if value.denominator != 1:
            raise ExprError(f"{value} is not a whole number.")
        return int(value)
    return value


def _norm(value):
    """A fraction that is whole becomes an int, so 6/2 compares and prints as 6."""
    if isinstance(value, Fraction) and value.denominator == 1:
        return int(value)
    return value


def round_half_up(n, unit=1):
    """n to the nearest `unit`, a half going up: (5,250, 100) -> 5,300."""
    n, unit = _num(n), _whole(unit)
    if unit <= 0:
        raise ExprError("round_half_up needs a unit above 0.")
    return _norm(Fraction(math.floor(Fraction(n) / unit + Fraction(1, 2))) * unit)


def ceil_div(a, b):
    a, b = _whole(a), _whole(b)
    if b == 0:
        raise ExprError("Division by zero.")
    return -(-a // b)


def digit(n, place):
    """The digit of n in `place` (1, 10, 100...): digit(58306, 1000) = 8."""
    n, place = abs(_whole(n)), _whole(place)
    if place <= 0:
        raise ExprError("digit needs a place of 1, 10, 100 and so on.")
    return (n // place) % 10


def count_digit(n, d):
    """How many times the digit d appears in n."""
    return str(abs(_whole(n))).count(str(_whole(d)))


def num_digits(n):
    return len(str(abs(_whole(n))))


def frac(a, b):
    a, b = _whole(a), _whole(b)
    if b == 0:
        raise ExprError("Division by zero.")
    return _norm(Fraction(a, b))


def numerator(x):
    return Fraction(_num(x)).numerator


def denominator(x):
    return Fraction(_num(x)).denominator


def gcd(a, b):
    return math.gcd(_whole(a), _whole(b))


def lcm(a, b):
    a, b = _whole(a), _whole(b)
    return abs(a * b) // math.gcd(a, b) if a and b else 0


def is_whole(x):
    return Fraction(_num(x)).denominator == 1


FUNCTIONS = {
    "min": lambda *a: _norm(min(_num(x) for x in a)),
    "max": lambda *a: _norm(max(_num(x) for x in a)),
    "abs": lambda x: _norm(abs(_num(x))),
    "floor": lambda x: math.floor(_num(x)),
    "ceil": lambda x: math.ceil(_num(x)),
    "round_half_up": round_half_up,
    "ceil_div": ceil_div,
    "digit": digit,
    "count_digit": count_digit,
    "num_digits": num_digits,
    "frac": frac,
    "numerator": numerator,
    "denominator": denominator,
    "gcd": gcd,
    "lcm": lcm,
    "is_whole": is_whole,
}

# How many arguments each function takes (low, high; None = any number).
ARITY = {
    "min": (1, None), "max": (1, None), "abs": (1, 1), "floor": (1, 1), "ceil": (1, 1),
    "round_half_up": (1, 2), "ceil_div": (2, 2), "digit": (2, 2), "count_digit": (2, 2), "num_digits": (1, 1),
    "frac": (2, 2), "numerator": (1, 1), "denominator": (1, 1), "gcd": (2, 2), "lcm": (2, 2), "is_whole": (1, 1),
}

_BINOPS = {
    ast.Add: lambda a, b: _num(a) + _num(b),
    ast.Sub: lambda a, b: _num(a) - _num(b),
    ast.Mult: lambda a, b: _num(a) * _num(b),
    ast.Div: lambda a, b: Fraction(_num(a)) / _num(b) if _num(b) != 0 else _raise("Division by zero."),
    ast.FloorDiv: lambda a, b: _num(a) // _num(b) if _num(b) != 0 else _raise("Division by zero."),
    ast.Mod: lambda a, b: _num(a) % _num(b) if _num(b) != 0 else _raise("Division by zero."),
    ast.Pow: lambda a, b: _power(a, b),
}
_COMPARE = {
    ast.Eq: lambda a, b: a == b,
    ast.NotEq: lambda a, b: a != b,
    ast.Lt: lambda a, b: _num(a) < _num(b),
    ast.LtE: lambda a, b: _num(a) <= _num(b),
    ast.Gt: lambda a, b: _num(a) > _num(b),
    ast.GtE: lambda a, b: _num(a) >= _num(b),
}


def _guard(value):
    """Every value worked out on the way, not only the result, stays small
    (review: a few nested powers could take minutes)."""
    if isinstance(value, bool) or not isinstance(value, (int, Fraction)):
        return value
    if isinstance(value, Fraction):
        if abs(value.numerator) > MAX_MAGNITUDE or value.denominator > MAX_MAGNITUDE:
            raise ExprError("A value is too large.")
    elif abs(value) > MAX_MAGNITUDE:
        raise ExprError("A value is too large.")
    return value


def _power(a, b):
    """a ** b, refused before it is worked out when it would be too large."""
    a, b = _guard(_num(a)), _small_power(b)
    if b and abs(a) > 1 and math.log10(abs(a)) * b > math.log10(MAX_MAGNITUDE):
        raise ExprError("A value is too large.")
    return a**b


def _raise(message):
    raise ExprError(message)


def _small_power(b):
    b = _whole(b)
    if not 0 <= b <= MAX_POWER:
        raise ExprError(f"Powers are limited to 0 to {MAX_POWER}.")
    return b


def parse(text: str) -> ast.Expression:
    """Parses and checks an expression; raises ExprError for anything not
    allowed. Done once, when a pattern is loaded."""
    if not isinstance(text, str) or not text.strip():
        raise ExprError("An expression is empty.")
    if len(text) > MAX_LENGTH:
        raise ExprError(f"An expression is longer than {MAX_LENGTH} characters.")
    try:
        tree = ast.parse(text.strip(), mode="eval")
    except SyntaxError as exc:
        raise ExprError(f"Can't read the expression {text!r}.") from exc
    for node in ast.walk(tree):
        _check_node(node, text)
    return tree


_ALLOWED = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.BoolOp, ast.Compare, ast.IfExp, ast.Call, ast.Name, ast.Load,
    ast.Attribute, ast.Constant, ast.And, ast.Or, ast.Not, ast.USub, ast.UAdd,
    *_BINOPS, *_COMPARE,
)


def _check_node(node, text):
    if not isinstance(node, _ALLOWED):
        raise ExprError(f"{type(node).__name__} is not allowed in {text!r}.")
    if isinstance(node, ast.Constant) and (isinstance(node.value, float) or not isinstance(node.value, (int, str, bool))):
        raise ExprError(f"Only whole numbers, text and True/False may be written in {text!r} (use frac(a, b) for fractions).")
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in FUNCTIONS or node.keywords:
            raise ExprError(f"Only these functions may be used: {', '.join(sorted(FUNCTIONS))}.")
        if any(isinstance(a, ast.Starred) for a in node.args):
            raise ExprError(f"{text!r} spreads arguments, which is not allowed.")
        low, high = ARITY[node.func.id]
        if len(node.args) < low or (high is not None and len(node.args) > high):
            raise ExprError(f"{node.func.id} is given {len(node.args)} values in {text!r}.")
    if isinstance(node, ast.Attribute):
        if node.attr.startswith("_") or not isinstance(node.value, (ast.Name, ast.Attribute)):
            raise ExprError(f"{text!r} reads a key that is not allowed.")
    if isinstance(node, ast.Name) and node.id.startswith("_"):
        raise ExprError(f"Names may not start with _ in {text!r}.")


def names_used(tree: ast.Expression) -> set[str]:
    """The pattern values an expression reads (functions excluded)."""
    used = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and not (node.id in FUNCTIONS or node.id in ("True", "False")):
            used.add(node.id)
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            used.discard(node.func.id)
    return used


def evaluate(tree: ast.Expression, env: dict):
    """Works out a parsed expression with the pattern's values."""
    try:
        value = _eval(tree.body, env)
    except ExprError:
        raise
    except (ArithmeticError, TypeError, ValueError, RecursionError) as exc:
        raise ExprError(f"Can't work this out ({type(exc).__name__}).") from exc
    if isinstance(value, (int, Fraction)) and not isinstance(value, bool) and abs(value) > MAX_MAGNITUDE:
        raise ExprError("A value is too large.")
    return _norm(value) if isinstance(value, Fraction) else value


def _eval(node, env):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id in ("True", "False"):
            return node.id == "True"
        if node.id not in env:
            raise ExprError(f"{node.id!r} has no value yet.")
        return env[node.id]
    if isinstance(node, ast.Attribute):
        record = _eval(node.value, env)
        if not isinstance(record, dict) or node.attr not in record:
            raise ExprError(f"There is no key {node.attr!r}.")
        return record[node.attr]
    if isinstance(node, ast.BinOp):
        return _guard(_BINOPS[type(node.op)](_eval(node.left, env), _eval(node.right, env)))
    if isinstance(node, ast.UnaryOp):
        value = _eval(node.operand, env)
        if isinstance(node.op, ast.Not):
            return not value
        return -_num(value) if isinstance(node.op, ast.USub) else _num(value)
    if isinstance(node, ast.BoolOp):
        if isinstance(node.op, ast.And):
            return all(bool(_eval(v, env)) for v in node.values)
        return any(bool(_eval(v, env)) for v in node.values)
    if isinstance(node, ast.Compare):
        left = _eval(node.left, env)
        for op, right_node in zip(node.ops, node.comparators):
            right = _eval(right_node, env)
            if not _COMPARE[type(op)](left, right):
                return False
            left = right
        return True
    if isinstance(node, ast.IfExp):
        return _eval(node.body, env) if _eval(node.test, env) else _eval(node.orelse, env)
    if isinstance(node, ast.Call):
        return _guard(FUNCTIONS[node.func.id](*[_eval(a, env) for a in node.args]))
    raise ExprError(f"{type(node).__name__} is not allowed.")  # parse() never lets one through
