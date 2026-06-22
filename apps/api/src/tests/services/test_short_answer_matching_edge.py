"""
Exhaustive EDGE-CASE unit tests for ``_check_short_answer``.

``_check_short_answer(answer, accepted, mode)`` grades real student
short-answer submissions, so these tests stress the messy inputs that occur in
production: unicode/accented text, stray whitespace and control characters,
dirty teacher-configured accepted-answer lists (empty / whitespace-only / None
/ non-string entries), and the four match modes (``exact``,
``case_insensitive``, ``contains``, ``regex``) including regex anchoring and
invalid-pattern safety.

These are NET-NEW cases that complement the happy-path coverage in
``test_assignment_grading.py::TestCheckShortAnswer`` (which already covers the
basic per-mode matches, simple trimming, the default-mode fallback, a single
invalid-regex case, a single multi-accepted case, and blank/None/non-list
guards). Each test documents its goal and asserts the *actual* observed
behavior of the function — surprising behaviors are called out in docstrings.

Realistic input shapes confirmed against the editor UI
(``TaskShortAnswerObject.tsx``): ``match_mode`` is one of the four literals and
defaults to ``"case_insensitive"``; ``accepted_answers`` is a list of strings.
"""

from src.services.courses.activities.assignments import _check_short_answer


# --------------------------------------------------------------------------- #
# Unicode / accents / case folding
# --------------------------------------------------------------------------- #
class TestUnicodeAndCaseFolding:
    def test_accented_exact_match(self):
        """Goal: an accented answer matches an identical accented expected in exact mode."""
        assert _check_short_answer("café", ["café"], "exact") is True

    def test_accented_case_insensitive_uppercase_student(self):
        """Goal: case-insensitive mode folds accented capitals (CAFÉ == café)."""
        assert _check_short_answer("CAFÉ", ["café"], "case_insensitive") is True

    def test_accented_differs_from_unaccented_in_exact(self):
        """Goal: 'cafe' must NOT match 'café' — accents are significant, not stripped."""
        assert _check_short_answer("cafe", ["café"], "exact") is False

    def test_accented_differs_from_unaccented_in_case_insensitive(self):
        """Goal: case folding does not strip accents; 'resume' != 'résumé'."""
        assert _check_short_answer("resume", ["résumé"], "case_insensitive") is False

    def test_nfc_vs_nfd_combining_marks_not_equal(self):
        """Goal: surprising-but-real — composed 'é' (NFC) does NOT equal decomposed
        'e' + combining accent (NFD). The matcher does no unicode normalization,
        so a student typing the visually-identical NFD form is marked wrong."""
        nfc = "é"          # é as one code point
        nfd = "é"          # e + COMBINING ACUTE ACCENT
        assert nfc != nfd
        assert _check_short_answer(nfd, [nfc], "exact") is False
        assert _check_short_answer(nfd, [nfc], "case_insensitive") is False

    def test_sharp_s_not_equal_to_double_s_uppercase(self):
        """Goal: surprising-but-real — German 'straße' is NOT matched by 'STRASSE'
        in case-insensitive mode. Python's str.lower() (not casefold) leaves 'ß'
        unchanged while 'STRASSE'.lower() -> 'strasse', so they differ."""
        assert _check_short_answer("STRASSE", ["straße"], "case_insensitive") is False

    def test_turkish_capital_i_folds_to_ascii_i(self):
        """Goal: ASCII 'I' lower-cases to 'i' (no Turkish locale handling), so
        'ISTANBUL' matches 'istanbul' case-insensitively."""
        assert _check_short_answer("ISTANBUL", ["istanbul"], "case_insensitive") is True

    def test_non_latin_script_exact(self):
        """Goal: non-Latin scripts (Japanese) match exactly when identical."""
        assert _check_short_answer("東京", ["東京"], "exact") is True

    def test_emoji_answer_exact(self):
        """Goal: emoji are treated as ordinary characters and match exactly."""
        assert _check_short_answer("🚀", ["🚀"], "exact") is True

    def test_greek_case_insensitive(self):
        """Goal: case-insensitive folding works for Greek (Σ -> σ)."""
        assert _check_short_answer("ΣΙΓΜΑ", ["σιγμα"], "case_insensitive") is True


# --------------------------------------------------------------------------- #
# Whitespace, tabs, newlines, control characters
# --------------------------------------------------------------------------- #
class TestWhitespaceHandling:
    def test_tab_padded_answer_is_trimmed(self):
        """Goal: leading/trailing tabs are stripped from the student answer."""
        assert _check_short_answer("\tParis\t", ["Paris"], "exact") is True

    def test_newline_padded_answer_is_trimmed(self):
        """Goal: leading/trailing newlines are stripped from the student answer."""
        assert _check_short_answer("\nParis\n", ["Paris"], "exact") is True

    def test_mixed_surrounding_whitespace_trimmed(self):
        """Goal: a mix of spaces/tabs/newlines around the answer is all stripped."""
        assert _check_short_answer(" \t\nParis \n\t ", ["Paris"], "exact") is True

    def test_internal_whitespace_is_preserved_exact(self):
        """Goal: surprising-but-real — only outer whitespace is trimmed; internal
        whitespace is NOT collapsed, so 'New  York' (two spaces) != 'New York'."""
        assert _check_short_answer("New  York", ["New York"], "exact") is False

    def test_internal_single_space_matches(self):
        """Goal: a normal single internal space matches the expected single space."""
        assert _check_short_answer("  New York  ", ["New York"], "exact") is True

    def test_accepted_entry_whitespace_is_also_trimmed(self):
        """Goal: the expected (accepted) entry is trimmed too, so a padded teacher
        entry '  Paris  ' still matches a clean student answer."""
        assert _check_short_answer("Paris", ["  Paris  "], "exact") is True

    def test_answer_only_spaces_is_false(self):
        """Goal: an answer of only spaces trims to empty -> non-answer -> False."""
        assert _check_short_answer("     ", ["Paris"], "exact") is False

    def test_answer_only_tabs_and_newlines_is_false(self):
        """Goal: an answer of only tabs/newlines trims to empty -> False."""
        assert _check_short_answer("\t\n\r ", ["Paris"], "case_insensitive") is False

    def test_nbsp_is_stripped(self):
        """Goal: a non-breaking space (U+00A0) IS stripped by Python str.strip(),
        so a NBSP-padded answer still matches a clean accepted entry. (str.strip
        treats NBSP as whitespace.)"""
        nbsp = "\u00a0"
        assert _check_short_answer(f"{nbsp}Paris{nbsp}", ["Paris"], "exact") is True

    def test_internal_nbsp_not_equal_to_regular_space(self):
        """Goal: surprising-but-real - an internal NBSP is NOT normalized to a
        regular space, so an NBSP-joined answer != a regular-space accepted entry."""
        nbsp = "\u00a0"
        assert _check_short_answer(f"New{nbsp}York", ["New York"], "exact") is False


# --------------------------------------------------------------------------- #
# Dirty accepted-answer lists (teacher-configured)
# --------------------------------------------------------------------------- #
class TestDirtyAcceptedList:
    def test_empty_string_entry_is_skipped(self):
        """Goal: an empty-string accepted entry never matches and is skipped, so a
        non-empty student answer against [""] is False."""
        assert _check_short_answer("Paris", [""], "exact") is False

    def test_empty_string_entry_does_not_match_empty_answer(self):
        """Goal: even a blank student answer does not match an empty accepted entry —
        the blank-answer guard returns False before the loop runs."""
        assert _check_short_answer("", [""], "exact") is False

    def test_whitespace_only_entry_is_skipped(self):
        """Goal: a whitespace-only accepted entry trims to empty and is skipped."""
        assert _check_short_answer("Paris", ["   "], "exact") is False

    def test_none_entry_is_skipped_but_others_checked(self):
        """Goal: a None entry in the list is skipped (non-str) without raising; a
        valid later entry can still match."""
        assert _check_short_answer("Paris", [None, "Paris"], "exact") is True

    def test_non_string_entries_are_skipped(self):
        """Goal: numeric / dict / list entries are skipped (isinstance str check);
        the integer 42 does NOT match the string answer '42'."""
        assert _check_short_answer("42", [42, {"a": 1}, [1, 2]], "exact") is False

    def test_non_string_entries_skipped_then_valid_match(self):
        """Goal: non-string junk earlier in the list does not block a valid later
        string match."""
        assert _check_short_answer("42", [42, None, "42"], "exact") is True

    def test_all_entries_invalid_is_false(self):
        """Goal: a list made entirely of skippable entries yields no match."""
        assert _check_short_answer("Paris", ["", "   ", None, 7], "exact") is False

    def test_empty_accepted_list_is_false(self):
        """Goal: an empty accepted list can never match anything."""
        assert _check_short_answer("Paris", [], "exact") is False

    def test_later_accepted_answer_matches_case_insensitive(self):
        """Goal: matching is order-independent — a match on the 3rd entry succeeds."""
        accepted = ["Lyon", "Marseille", "Paris"]
        assert _check_short_answer("PARIS", accepted, "case_insensitive") is True

    def test_duplicate_accepted_entries_still_match(self):
        """Goal: duplicate accepted entries do not break matching."""
        assert _check_short_answer("Paris", ["Paris", "Paris"], "exact") is True


# --------------------------------------------------------------------------- #
# Non-list / unusual `accepted` argument
# --------------------------------------------------------------------------- #
class TestNonListAccepted:
    def test_tuple_accepted_is_false(self):
        """Goal: surprising-but-real — a tuple is NOT a list, so even though it
        contains a matching string it returns False (strict isinstance(list))."""
        assert _check_short_answer("Paris", ("Paris",), "exact") is False

    def test_set_accepted_is_false(self):
        """Goal: a set is not a list -> False."""
        assert _check_short_answer("Paris", {"Paris"}, "exact") is False

    def test_none_accepted_is_false(self):
        """Goal: accepted=None -> not a list -> False (no crash)."""
        assert _check_short_answer("Paris", None, "exact") is False

    def test_dict_accepted_is_false(self):
        """Goal: a dict is not a list -> False, even if a key matches."""
        assert _check_short_answer("Paris", {"Paris": 1}, "exact") is False


# --------------------------------------------------------------------------- #
# Regex special characters treated literally in non-regex modes
# --------------------------------------------------------------------------- #
class TestRegexCharsLiteralInNonRegexModes:
    def test_dot_is_literal_in_exact(self):
        """Goal: in exact mode '.' is a literal dot, so 'a.c' does NOT match 'abc'."""
        assert _check_short_answer("abc", ["a.c"], "exact") is False

    def test_dot_literal_matches_literal_in_exact(self):
        """Goal: 'a.c' matches the literal answer 'a.c' in exact mode."""
        assert _check_short_answer("a.c", ["a.c"], "exact") is True

    def test_special_chars_literal_in_contains(self):
        """Goal: in contains mode regex metacharacters are literal substrings; the
        student answer must literally contain '(c++)'."""
        assert _check_short_answer("I love (c++) a lot", ["(c++)"], "contains") is True

    def test_star_is_literal_in_case_insensitive(self):
        """Goal: '*' is literal in case_insensitive mode; '5*3' != '53'."""
        assert _check_short_answer("53", ["5*3"], "case_insensitive") is False


# --------------------------------------------------------------------------- #
# Regex mode behavior
# --------------------------------------------------------------------------- #
class TestRegexMode:
    def test_anchoring_digits_does_not_match_trailing_letter(self):
        """Goal: re.fullmatch anchors the whole string, so r'\\d+' does NOT match
        '12a' (the trailing 'a' breaks the full match)."""
        assert _check_short_answer("12a", [r"\d+"], "regex") is False

    def test_anchoring_digits_matches_pure_number(self):
        """Goal: r'\\d+' fully matches a pure digit string."""
        assert _check_short_answer("12345", [r"\d+"], "regex") is True

    def test_partial_pattern_does_not_match_longer_string(self):
        """Goal: an un-anchored-looking pattern still must fullmatch, so 'hel' does
        NOT match 'hello' (no implicit substring search in regex mode)."""
        assert _check_short_answer("hello", ["hel"], "regex") is False

    def test_alternation(self):
        """Goal: regex alternation 'cat|dog' matches either alternative fully."""
        assert _check_short_answer("dog", ["cat|dog"], "regex") is True
        assert _check_short_answer("cat", ["cat|dog"], "regex") is True

    def test_alternation_rejects_other(self):
        """Goal: alternation does not match a value outside the set."""
        assert _check_short_answer("bird", ["cat|dog"], "regex") is False

    def test_character_class(self):
        """Goal: a character-class + quantifier pattern matches an in-class string."""
        assert _check_short_answer("aZ9_", [r"[a-zA-Z0-9_]+"], "regex") is True

    def test_character_class_rejects_out_of_class(self):
        """Goal: a value containing an out-of-class char fails the fullmatch."""
        assert _check_short_answer("aZ9-", [r"[a-zA-Z0-9_]+"], "regex") is False

    def test_regex_is_case_insensitive(self):
        """Goal: regex mode uses re.IGNORECASE, so a literal 'paris' pattern matches
        'PARIS'."""
        assert _check_short_answer("PARIS", ["paris"], "regex") is True

    def test_explicit_anchors_in_pattern_are_harmless(self):
        """Goal: a teacher who writes explicit '^...$' anchors still matches (extra
        anchors are redundant with fullmatch, not harmful)."""
        assert _check_short_answer("yes", ["^yes$"], "regex") is True

    def test_quantifier_optional(self):
        """Goal: optional groups via '?' match both presence and absence."""
        assert _check_short_answer("color", ["colou?r"], "regex") is True
        assert _check_short_answer("colour", ["colou?r"], "regex") is True

    def test_whitespace_pattern_with_anchors(self):
        """Goal: a regex allowing variable internal spaces (\\s+) matches a
        double-spaced answer that exact mode would reject."""
        assert _check_short_answer("New  York", [r"New\s+York"], "regex") is True

    def test_dot_star_matches_anything_nonblank(self):
        """Goal: an overly-broad teacher pattern '.+' matches any non-blank answer
        (a real correctness risk worth noting, but valid behavior)."""
        assert _check_short_answer("literally anything", [".+"], "regex") is True


# --------------------------------------------------------------------------- #
# Invalid / dangerous regex patterns must never raise
# --------------------------------------------------------------------------- #
class TestInvalidRegexNeverRaises:
    def test_unbalanced_paren_is_false(self):
        """Goal: an unbalanced '(' is invalid regex -> caught -> False (no raise)."""
        assert _check_short_answer("anything", ["(bad"], "regex") is False

    def test_unbalanced_bracket_is_false(self):
        """Goal: an unclosed character class '[' is invalid -> False (no raise)."""
        assert _check_short_answer("anything", ["[abc"], "regex") is False

    def test_bad_escape_is_false(self):
        """Goal: a bad trailing escape sequence is invalid regex -> False (no raise).
        Note: in modern Python r'\\q' raises re.error (bad escape)."""
        assert _check_short_answer("q", [r"\q"], "regex") is False

    def test_dangling_quantifier_is_false(self):
        """Goal: a quantifier with nothing to repeat ('*abc') is invalid -> False."""
        assert _check_short_answer("abc", ["*abc"], "regex") is False

    def test_invalid_regex_then_valid_regex_matches(self):
        """Goal: an invalid pattern is skipped without raising, and a valid later
        pattern can still match."""
        assert _check_short_answer("cat", ["(bad", "c.t"], "regex") is True

    def test_nested_quantifier_pattern_short_input(self):
        """Goal: a pattern prone to catastrophic backtracking still resolves on a
        short input and matches (no hang on the small strings short-answer uses)."""
        assert _check_short_answer("aaaa", [r"(a+)+"], "regex") is True


# --------------------------------------------------------------------------- #
# Contains mode positional coverage
# --------------------------------------------------------------------------- #
class TestContainsPositions:
    def test_contains_at_start(self):
        """Goal: contains matches when the needle is at the start of the answer."""
        assert _check_short_answer("Paris is nice", ["paris"], "contains") is True

    def test_contains_in_middle(self):
        """Goal: contains matches when the needle is in the middle."""
        assert _check_short_answer("I visited Paris last year", ["paris"], "contains") is True

    def test_contains_at_end(self):
        """Goal: contains matches when the needle is at the end."""
        assert _check_short_answer("the capital is Paris", ["paris"], "contains") is True

    def test_contains_exact_whole_string(self):
        """Goal: contains matches when needle equals the whole answer."""
        assert _check_short_answer("Paris", ["Paris"], "contains") is True

    def test_contains_substring_inside_word_matches(self):
        """Goal: surprising-but-real — contains has no word boundaries, so 'cat'
        matches inside 'category' (could over-credit, but is the actual behavior)."""
        assert _check_short_answer("category theory", ["cat"], "contains") is True

    def test_contains_not_present_is_false(self):
        """Goal: contains returns False when the needle is absent."""
        assert _check_short_answer("Berlin is nice", ["paris"], "contains") is False

    def test_contains_is_case_insensitive_both_sides(self):
        """Goal: contains lower-cases both sides, so case never affects the match."""
        assert _check_short_answer("THE CITY OF PARIS", ["pArIs"], "contains") is True


# --------------------------------------------------------------------------- #
# Unknown / garbage match mode
# --------------------------------------------------------------------------- #
class TestUnknownMode:
    def test_unknown_mode_falls_through_to_false(self):
        """Goal: an unrecognized mode matches none of the branches and falls through
        to return False, even when answer equals an accepted entry."""
        assert _check_short_answer("Paris", ["Paris"], "fuzzy") is False

    def test_empty_string_mode_falls_through(self):
        """Goal: surprising-but-real — an empty-string mode is falsy, so
        `mode or 'case_insensitive'` defaults it to case_insensitive (NOT a
        fall-through). So 'paris' matches 'Paris'."""
        assert _check_short_answer("paris", ["Paris"], "") is True

    def test_garbage_mode_with_exact_match_still_false(self):
        """Goal: a typo'd mode like 'Exact' (wrong case) is unknown -> False."""
        assert _check_short_answer("Paris", ["Paris"], "Exact") is False

    def test_numeric_mode_value_falls_through(self):
        """Goal: a truthy non-string mode (e.g. an int) equals no branch -> False."""
        assert _check_short_answer("Paris", ["Paris"], 1) is False


# --------------------------------------------------------------------------- #
# Numeric-looking answers and very long inputs
# --------------------------------------------------------------------------- #
class TestNumericAndLongInputs:
    def test_numeric_string_exact(self):
        """Goal: numeric-looking answers are plain strings; '42' matches '42'."""
        assert _check_short_answer("42", ["42"], "exact") is True

    def test_numeric_string_no_float_normalization(self):
        """Goal: surprising-but-real — short-answer does NO numeric parsing, so
        '5.0' does NOT match '5' (use a number task for numeric tolerance)."""
        assert _check_short_answer("5.0", ["5"], "exact") is False

    def test_numeric_string_leading_zero_significant(self):
        """Goal: leading zeros are significant in string comparison; '007' != '7'."""
        assert _check_short_answer("007", ["7"], "exact") is False

    def test_non_string_answer_is_coerced_to_str(self):
        """Goal: a non-string answer is coerced via str(); the int 42 becomes '42'
        and matches accepted '42'."""
        assert _check_short_answer(42, ["42"], "exact") is True

    def test_bool_answer_coerced_to_str(self):
        """Goal: surprising-but-real — a bool answer is str()-coerced to 'True',
        which does not match accepted 'true' in exact mode (capital T)."""
        assert _check_short_answer(True, ["true"], "exact") is False

    def test_bool_answer_case_insensitive_match(self):
        """Goal: str(True) == 'True' matches accepted 'true' in case_insensitive."""
        assert _check_short_answer(True, ["true"], "case_insensitive") is True

    def test_very_long_answer_exact_match(self):
        """Goal: a very long (10k char) answer matches an identical accepted entry."""
        long = "x" * 10_000
        assert _check_short_answer(long, [long], "exact") is True

    def test_very_long_answer_one_char_off_is_false(self):
        """Goal: a 10k-char answer that differs by one trailing char is False."""
        long = "x" * 10_000
        assert _check_short_answer(long + "y", [long], "exact") is False

    def test_very_long_answer_contains(self):
        """Goal: contains finds a short needle inside a very long answer."""
        long = "a" * 5_000 + "PARIS" + "b" * 5_000
        assert _check_short_answer(long, ["paris"], "contains") is True
