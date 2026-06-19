"""
Exhaustive EDGE-CASE tests for ``_check_number_answer`` — the server-side
numeric-answer grader in
``src.services.courses.activities.assignments``.

These are NET-NEW cases that complement (not duplicate) the happy-path
``TestCheckNumberAnswer`` suite in ``test_assignment_grading.py``. Every
ambiguous case below was verified empirically against the real function
before being asserted, so the tests document REAL behavior (including a
couple of surprising-but-intentional quirks of Python's ``float()``).

Reference behavior (assignments.py lines 197-222):
    cleaned = str(answer_raw).strip().replace(",", ".")
    parsed = float(cleaned)              # rejects on ValueError/TypeError
    reject if not math.isfinite(parsed)  # filters nan / inf / Infinity
    correct = float(correct_value or 0); tol = abs(float(tolerance or 0))
    return abs(parsed - correct) <= tol
"""


import pytest

from src.services.courses.activities.assignments import _check_number_answer


# --------------------------------------------------------------------------- #
# Sign handling: negatives, zero, leading "+"
# --------------------------------------------------------------------------- #
class TestSigns:
    def test_negative_answer_exact_match(self):
        """A negative correct answer matches a negative student answer."""
        assert _check_number_answer("-5", -5, 0) is True

    def test_negative_within_tolerance(self):
        """abs(diff) ignores sign, so -4.5 is within ±0.5 of -5."""
        assert _check_number_answer("-4.5", -5, 0.5) is True

    def test_negative_outside_tolerance(self):
        """-6 is 1.0 away from -5, outside a ±0.5 band."""
        assert _check_number_answer("-6", -5, 0.5) is False

    def test_wrong_sign_fails(self):
        """+5 is 10 away from -5 and must not earn credit."""
        assert _check_number_answer("5", -5, 0.5) is False

    def test_zero_exact(self):
        """Zero is a valid numeric answer (not treated as blank)."""
        assert _check_number_answer("0", 0, 0) is True

    def test_negative_zero_equals_zero(self):
        """'-0' parses to -0.0 which equals 0.0."""
        assert _check_number_answer("-0", 0, 0) is True

    def test_leading_plus_sign_accepted(self):
        """A leading '+' is accepted by float() (e.g. student types '+5')."""
        assert _check_number_answer("+5", 5, 0) is True

    def test_leading_plus_with_decimal(self):
        """'+3.14' parses to 3.14."""
        assert _check_number_answer("+3.14", 3.14, 0) is True


# --------------------------------------------------------------------------- #
# Tolerance boundary semantics (inclusive <=)
# --------------------------------------------------------------------------- #
class TestToleranceBoundary:
    def test_tolerance_exactly_equal_to_diff_passes(self):
        """Boundary is INCLUSIVE: diff == tol returns True (abs <= tol)."""
        # diff is exactly 0.5, tolerance is exactly 0.5
        assert _check_number_answer("10.5", 10, 0.5) is True
        assert _check_number_answer("9.5", 10, 0.5) is True

    def test_just_outside_tolerance_fails(self):
        """A hair past the band fails: diff 0.5000001 > tol 0.5."""
        assert _check_number_answer("10.5000001", 10, 0.5) is False

    def test_just_inside_tolerance_passes(self):
        """Just inside the band passes: diff 0.4999999 < tol 0.5."""
        assert _check_number_answer("10.4999999", 10, 0.5) is True

    def test_zero_tolerance_requires_exact(self):
        """With tol=0 only an exact match passes."""
        assert _check_number_answer("10", 10, 0) is True
        assert _check_number_answer("10.0001", 10, 0) is False

    def test_huge_tolerance_accepts_anything_finite(self):
        """A massive tolerance accepts wildly wrong (but finite) answers."""
        assert _check_number_answer("1000000", 0, 1e12) is True

    def test_negative_tolerance_abs_inside(self):
        """Negative tolerance is abs()'d: -0.5 acts as a ±0.5 band (inside)."""
        assert _check_number_answer("10.3", 10, -0.5) is True

    def test_negative_tolerance_abs_outside(self):
        """Negative tolerance is abs()'d: still rejects out-of-band values."""
        assert _check_number_answer("11", 10, -0.5) is False


# --------------------------------------------------------------------------- #
# Comma decimals & separator quirks
# --------------------------------------------------------------------------- #
class TestCommaAndSeparators:
    def test_comma_decimal_negative(self):
        """Comma decimal works with negatives: '-3,5' -> -3.5."""
        assert _check_number_answer("-3,5", -3.5, 0) is True

    def test_pi_comma_decimal(self):
        """'3,14' (European decimal) parses to 3.14."""
        assert _check_number_answer("3,14", 3.14, 0) is True

    def test_comma_thousands_is_misread_as_decimal(self):
        """SURPRISING-BUT-REAL: '1,000' is NOT a thousands separator.

        The function does a naive ``replace(",", ".")`` so '1,000'
        becomes '1.000' == 1.0, NOT 1000. A student meaning one thousand
        would be graded as 1.0.
        """
        assert _check_number_answer("1,000", 1, 0) is True
        assert _check_number_answer("1,000", 1000, 0) is False

    def test_multiple_commas_fail(self):
        """'1,5,5' -> '1.5.5' which is not a valid float."""
        assert _check_number_answer("1,5,5", 1.55, 0.01) is False

    def test_underscore_separator_accepted_by_float(self):
        """SURPRISING-BUT-REAL: Python float() accepts '1_000' as 1000.

        Python numeric-literal underscores survive the parse, so a
        student typing '1_000' is graded as one thousand.
        """
        assert _check_number_answer("1_000", 1000, 0) is True


# --------------------------------------------------------------------------- #
# Scientific notation
# --------------------------------------------------------------------------- #
class TestScientificNotation:
    def test_lowercase_e(self):
        """'1e3' parses to 1000.0."""
        assert _check_number_answer("1e3", 1000, 0) is True

    def test_uppercase_e(self):
        """'1E3' parses to 1000.0 (case-insensitive exponent)."""
        assert _check_number_answer("1E3", 1000, 0) is True

    def test_negative_exponent(self):
        """'5e-3' parses to 0.005."""
        assert _check_number_answer("5e-3", 0.005, 0) is True

    def test_scientific_with_comma_mantissa(self):
        """'1,5e2' -> '1.5e2' == 150."""
        assert _check_number_answer("1,5e2", 150, 0) is True


# --------------------------------------------------------------------------- #
# Whitespace handling
# --------------------------------------------------------------------------- #
class TestWhitespace:
    def test_surrounding_whitespace_stripped(self):
        """Leading/trailing spaces are stripped before parsing."""
        assert _check_number_answer("  3.14  ", 3.14, 0) is True

    def test_tabs_and_newlines_stripped(self):
        """str.strip() removes tabs/newlines too."""
        assert _check_number_answer("\t\n5\n\t", 5, 0) is True

    def test_internal_whitespace_fails(self):
        """Whitespace INSIDE the number is not removed -> parse fails."""
        assert _check_number_answer("3 14", 314, 0) is False


# --------------------------------------------------------------------------- #
# Non-finite rejection (nan / inf / Infinity in various forms)
# --------------------------------------------------------------------------- #
class TestNonFiniteRejected:
    @pytest.mark.parametrize(
        "raw",
        ["inf", "-inf", "+inf", "Infinity", "-Infinity", "INF", "nan", "NaN", "-nan"],
    )
    def test_non_finite_strings_rejected(self, raw):
        """float() parses these, but math.isfinite filters them out -> False.

        This is the key guard: even a huge tolerance must not let 'inf'
        (which would satisfy abs(diff) <= tol vacuously via inf<=inf=True
        for inf tol) earn credit.
        """
        assert _check_number_answer(raw, 0, 1e12) is False

    def test_nan_never_within_any_tolerance(self):
        """nan would make every comparison False anyway, but is rejected first."""
        assert _check_number_answer("nan", 0, 0) is False


# --------------------------------------------------------------------------- #
# Malformed / non-numeric answers
# --------------------------------------------------------------------------- #
class TestMalformed:
    def test_two_decimal_points_fail(self):
        """'1.2.3' is not a valid float."""
        assert _check_number_answer("1.2.3", 1, 0) is False

    def test_alpha_suffix_fails(self):
        """'5px' / units appended to the number are rejected."""
        assert _check_number_answer("5px", 5, 0) is False

    def test_currency_symbol_fails(self):
        """'$5' is not parseable."""
        assert _check_number_answer("$5", 5, 0) is False

    def test_percent_sign_fails(self):
        """'50%' is not parseable as a bare float."""
        assert _check_number_answer("50%", 50, 0) is False

    def test_empty_after_strip_fails(self):
        """A string of only whitespace becomes '' and is rejected."""
        assert _check_number_answer("\n\t  ", 0, 0) is False

    def test_hex_literal_fails(self):
        """'0x10' is a valid int literal but NOT a valid float()."""
        assert _check_number_answer("0x10", 16, 0) is False

    def test_bare_minus_fails(self):
        """A lone '-' is not a number."""
        assert _check_number_answer("-", 0, 0) is False


# --------------------------------------------------------------------------- #
# Magnitude extremes & float precision
# --------------------------------------------------------------------------- #
class TestMagnitudeAndPrecision:
    def test_very_large_float(self):
        """A near-max-double value compares correctly to itself."""
        assert _check_number_answer("1e308", 1e308, 0) is True

    def test_overflow_to_inf_rejected(self):
        """'1e400' overflows to float('inf') and is rejected by isfinite.

        Even with an enormous tolerance the answer cannot earn credit.
        """
        assert _check_number_answer("1e400", 0, 1e308) is False

    def test_very_small_float(self):
        """A tiny subnormal value compares correctly to itself."""
        assert _check_number_answer("1e-300", 1e-300, 0) is True

    def test_underflow_to_zero(self):
        """'1e-400' underflows to 0.0 (finite) and matches correct=0."""
        assert _check_number_answer("1e-400", 0, 0) is True

    def test_float_precision_breaks_zero_tolerance(self):
        """SURPRISING-BUT-REAL: 0.1+0.2 != 0.3 in IEEE-754.

        With tol=0, a student answer of '0.3' fails against a correct
        value computed as 0.1+0.2 (diff ~5.55e-17). Authors should set a
        nonzero tolerance for fractional answers.
        """
        assert _check_number_answer("0.3", 0.1 + 0.2, 0) is False

    def test_float_precision_passes_with_epsilon_tolerance(self):
        """A tiny tolerance absorbs the IEEE-754 rounding error."""
        assert _check_number_answer("0.3", 0.1 + 0.2, 1e-9) is True


# --------------------------------------------------------------------------- #
# correct_value / tolerance argument coercion (None, str, int/float)
# --------------------------------------------------------------------------- #
class TestArgCoercion:
    def test_correct_value_none_defaults_to_zero(self):
        """correct_value=None is treated as 0."""
        assert _check_number_answer("0", None, 0) is True
        assert _check_number_answer("1", None, 0) is False

    def test_tolerance_none_defaults_to_zero(self):
        """tolerance=None is treated as 0 -> exact match required."""
        assert _check_number_answer("5", 5, None) is True
        assert _check_number_answer("5.1", 5, None) is False

    def test_correct_value_as_string_numeric(self):
        """A numeric string correct_value is coerced via float()."""
        assert _check_number_answer("5", "5.0", 0) is True

    def test_tolerance_as_string_numeric(self):
        """A numeric string tolerance is coerced via float()."""
        assert _check_number_answer("5", 4, "1") is True
        assert _check_number_answer("5", 4, "0.5") is False

    def test_correct_value_non_numeric_string_returns_false(self):
        """A non-numeric correct_value raises ValueError -> caught -> False."""
        assert _check_number_answer("5", "abc", 0) is False

    def test_tolerance_non_numeric_string_returns_false(self):
        """A non-numeric tolerance raises ValueError -> caught -> False."""
        assert _check_number_answer("5", 5, "wide") is False

    def test_tolerance_string_with_comma_not_normalized(self):
        """Only the ANSWER gets comma->dot; tolerance does not, so '0,5' fails parse."""
        # '0,5' -> float() raises -> caught -> False
        assert _check_number_answer("5", 5, "0,5") is False

    def test_int_answer_equals_float_correct(self):
        """Integer-looking answer compares equal to float correct value."""
        assert _check_number_answer("42", 42.0, 0) is True

    def test_float_answer_equals_int_correct(self):
        """Float-looking answer compares equal to int correct value."""
        assert _check_number_answer("42.0", 42, 0) is True


# --------------------------------------------------------------------------- #
# Non-string answer_raw inputs (str() coercion)
# --------------------------------------------------------------------------- #
class TestNonStringAnswerInputs:
    def test_int_answer_raw(self):
        """An int answer_raw is str()'d then parsed."""
        assert _check_number_answer(42, 42, 0) is True

    def test_float_answer_raw(self):
        """A float answer_raw is str()'d then parsed."""
        assert _check_number_answer(3.14, 3.14, 0) is True

    def test_bool_true_coerces_to_one(self):
        """SURPRISING-BUT-REAL: str(True) == 'True' which is NOT a float -> False."""
        assert _check_number_answer(True, 1, 0) is False

    def test_list_answer_raw_fails(self):
        """A list str()'s to '[1]' which is not parseable -> False."""
        assert _check_number_answer([1], 1, 0) is False


# --------------------------------------------------------------------------- #
# Unicode digits
# --------------------------------------------------------------------------- #
class TestUnicodeDigits:
    def test_arabic_indic_digits_accepted(self):
        """SURPRISING-BUT-REAL: Python float() accepts unicode decimal digits.

        Arabic-Indic '٩' (9) parses to 9.0, so it earns credit.
        """
        assert _check_number_answer("٩", 9, 0) is True

    def test_fullwidth_digit_accepted(self):
        """Full-width '９' (9) is also accepted by float() -> 9.0."""
        assert _check_number_answer("９", 9, 0) is True


# --------------------------------------------------------------------------- #
# Return type is always a real bool (never truthy non-bool)
# --------------------------------------------------------------------------- #
def test_always_returns_bool():
    """The function must return a genuine bool, not e.g. a numpy bool or int."""
    for r in [_check_number_answer("5", 5, 0), _check_number_answer("x", 5, 0)]:
        assert r is True or r is False
        assert isinstance(r, bool)
