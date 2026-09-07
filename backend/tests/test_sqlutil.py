"""``app.sqlutil`` — the only thing standing between user input and SQL.

These are pure functions with no I/O, and every list filter, sort column and
search value in the app passes through them, so they get the most adversarial
treatment in the suite. The module docstring promises "user input never reaches
SQL unescaped"; these tests are that promise written down.
"""

from __future__ import annotations

import pytest

from app.errors import ApiError
from app.sqlutil import ident, like_literal, sql_literal


# ===========================================================================
# ident() — identifiers are allow-listed, never escaped
# ===========================================================================


@pytest.mark.parametrize(
    "value",
    [
        "properties",
        "work_orders",
        "_private",
        "a",
        "A1",
        "camelCase",
        "UPPER_SNAKE_99",
        "_",
        "x" * 200,  # no length cap by design; InventDB rejects over-long names
    ],
)
def test_ident_accepts_plain_identifiers(value):
    assert ident(value) == value


@pytest.mark.parametrize(
    "value",
    [
        "",
        " ",
        "1abc",  # may not start with a digit
        "9",
        "-x",
        "a-b",
        "a b",
        "a.b",  # qualified names are composed by the caller, not passed whole
        "a,b",
        "a;b",
        "a'b",
        'a"b',
        "a`b",
        "a(b)",
        "a*",
        "*",
        "a/*b*/",
        "table--",
        "ñame",  # non-ASCII letters are outside the allow-list
        "a\tb",
        "a b OR 1=1",
        "1; DROP TABLE properties",
        "properties; DROP TABLE properties; --",
        "properties WHERE 1=1",
        "properties\x00",
    ],
)
def test_ident_rejects_anything_else(value):
    with pytest.raises(ApiError) as exc:
        ident(value)
    assert exc.value.status_code == 400


@pytest.mark.parametrize("value", ["properties\n", "properties\r\n", "properties\n\n"])
def test_ident_rejects_trailing_newlines(value):
    """A trailing newline must not slip past the identifier check.

    Python's ``$`` matches at the end of the string *or* immediately before a
    final newline, so the natural-looking ``^ident$`` accepts ``"properties\\n"``.
    Harmless on its own — SQL treats the newline as whitespace — but an
    allow-list that accepts a character it never meant to is exactly the kind of
    near-miss worth nailing shut. ``sqlutil`` uses ``re.fullmatch`` for this.
    """
    with pytest.raises(ApiError):
        ident(value)


@pytest.mark.parametrize("value", [None, 1, 1.5, True, [], {}, ("a",), b"abc"])
def test_ident_rejects_non_strings(value):
    """Non-strings are rejected before they can reach ``re.fullmatch``.

    ``request.args`` only ever yields strings, but ``ident`` is also called with
    values from the entity registry and from stored report templates, so the
    type check is load-bearing rather than defensive noise.
    """
    with pytest.raises(ApiError) as exc:
        ident(value)
    assert exc.value.status_code == 400


def test_ident_error_names_the_field_and_quotes_the_value():
    with pytest.raises(ApiError) as exc:
        ident("a b", "order_by")
    detail = str(exc.value.detail)
    assert "order_by" in detail
    assert "'a b'" in detail  # repr'd, so the offending value can't forge the message


# ===========================================================================
# sql_literal() — values are quoted and escaped
# ===========================================================================


def test_sql_literal_none_is_unquoted_null():
    assert sql_literal(None) == "NULL"


@pytest.mark.parametrize("value,expected", [(True, "TRUE"), (False, "FALSE")])
def test_sql_literal_booleans_come_before_numbers(value, expected):
    """``bool`` is a subclass of ``int``, so order of the isinstance checks matters.

    If the numeric branch ran first, ``True`` would render as ``1`` — which most
    engines accept, but ``False`` rendering as ``0`` silently changes the
    meaning of a boolean column comparison on engines that distinguish them.
    """
    assert sql_literal(value) == expected


@pytest.mark.parametrize(
    "value,expected",
    [
        (0, "0"),
        (7, "7"),
        (-42, "-42"),
        (10**20, "100000000000000000000"),
        (1.5, "1.5"),
        (-0.25, "-0.25"),
        (1e10, "10000000000.0"),
    ],
)
def test_sql_literal_numbers_are_emitted_bare(value, expected):
    assert sql_literal(value) == expected


@pytest.mark.parametrize(
    "value,expected",
    [
        ("", "''"),
        ("Mumbai", "'Mumbai'"),
        ("O'Brien", "'O''Brien'"),
        ("'", "''''"),  # -> '' escaped, wrapped: ' + '' + '
        ("''", "''''''"),
        ("O''Brien", "'O''''Brien'"),  # already-doubled quotes are doubled again
        ("it's a 'test'", "'it''s a ''test'''"),
        ('say "hi"', "'say \"hi\"'"),  # double quotes need no escaping in a literal
    ],
)
def test_sql_literal_escapes_single_quotes(value, expected):
    assert sql_literal(value) == expected


@pytest.mark.parametrize(
    "attack",
    [
        "' OR '1'='1",
        "'; DROP TABLE properties; --",
        "' UNION SELECT * FROM _System.Users --",
        "x' AND (SELECT COUNT(*) FROM pms.tenants) > 0 --",
        "'||(SELECT password FROM users)||'",
        "admin'--",
        "' OR 1=1 /*",
    ],
)
def test_sql_literal_renders_injection_attempts_as_one_literal(attack):
    """The payload must survive as data: one opening quote, one closing quote.

    Counting quotes is the actual invariant — a rendered literal is safe iff
    every interior quote is doubled, which means the total count is even and the
    string ends where it started.
    """
    rendered = sql_literal(attack)
    assert rendered.startswith("'") and rendered.endswith("'")
    assert rendered.count("'") % 2 == 0
    # Every interior quote is part of a doubled pair.
    interior = rendered[1:-1]
    assert interior.replace("''", "").count("'") == 0


@pytest.mark.parametrize(
    "value,expected",
    [
        ("a\x00b", "'ab'"),
        ("\x00", "''"),
        ("\x00'; DROP TABLE x; --", "'''; DROP TABLE x; --'"),
        ("a\x00\x00b", "'ab'"),
    ],
)
def test_sql_literal_strips_null_bytes(value, expected):
    """NUL is removed, not escaped.

    A NUL can truncate a C-string parser mid-statement, so dropping it entirely
    is the right call — and it happens *before* quote escaping, so a NUL cannot
    be used to split a quote pair.
    """
    assert sql_literal(value) == expected
    assert "\x00" not in sql_literal(value)


@pytest.mark.parametrize(
    "value",
    ["line\nbreak", "tab\there", "carriage\rreturn", "vertical\vtab", "form\ffeed"],
)
def test_sql_literal_keeps_other_control_characters_inside_the_quotes(value):
    """Whitespace controls stay verbatim — they're legal inside a quoted string."""
    rendered = sql_literal(value)
    assert rendered == "'" + value + "'"
    assert rendered.count("'") == 2


@pytest.mark.parametrize(
    "value", ["Mumbai — West", "naïve", "日本語", "emoji 🏠", "Ünïcödé"]
)
def test_sql_literal_passes_unicode_through_unchanged(value):
    assert sql_literal(value) == f"'{value}'"


@pytest.mark.parametrize(
    "value,expected",
    [
        ({"a": 1}, "'{''a'': 1}'"),
        ([1, 2], "'[1, 2]'"),
        (object, None),  # only checked for quoting, repr is unstable
    ],
)
def test_sql_literal_stringifies_unexpected_types(value, expected):
    """Anything not None/bool/number falls through ``str()`` and gets quoted.

    Reachable through ``list_records``' filter loop only if a caller hands it a
    non-string; the guarantee that matters is that it is still quoted.
    """
    rendered = sql_literal(value)
    assert rendered.startswith("'") and rendered.endswith("'")
    if expected is not None:
        assert rendered == expected


def test_sql_literal_of_nan_and_infinity_is_not_valid_sql():
    """Documents a latent hazard rather than a live bug.

    ``repr(float("nan"))`` is ``nan``, which is emitted bare and is not a valid
    literal in any SQL dialect. It is unreachable today — the only caller feeds
    ``sql_literal`` values from ``request.args``, which are always strings — but
    it becomes a syntax error the moment a JSON body is routed through here.
    """
    assert sql_literal(float("nan")) == "nan"
    assert sql_literal(float("inf")) == "inf"


def test_sql_literal_does_not_escape_backslashes():
    """Documents dialect-dependent risk. See the suite README.

    In strict-SQL engines (and PostgreSQL with ``standard_conforming_strings``
    on, the default) a backslash inside a quoted literal is just a backslash and
    this is correct. In MySQL-style engines it is an escape character, and a
    value ending in a lone backslash would escape the closing quote and break
    out of the literal.

    Blindly escaping backslashes would corrupt legitimate data (a Windows path
    would gain doubled separators) on the engines where it isn't needed, so this
    asserts today's behaviour and flags the question rather than guessing at
    the target dialect.
    """
    assert sql_literal("C:\\Users\\pms") == "'C:\\Users\\pms'"
    assert sql_literal("trailing\\") == "'trailing\\'"


# ===========================================================================
# like_literal() — currently unused by the app
# ===========================================================================


def test_like_literal_wraps_in_wildcards_and_escapes_quotes():
    assert like_literal("brien") == "'%brien%'"
    assert like_literal("O'Brien") == "'%O''Brien%'"
    assert like_literal("a\x00b") == "'%ab%'"


@pytest.mark.parametrize("value", ["100%", "a_b", "%", "_", "%%"])
def test_like_literal_does_not_escape_like_wildcards(value):
    """The docstring claims wildcards are escaped; they are not.

    A user searching for ``100%`` gets a pattern that matches every row rather
    than the rows containing "100%". Not a security issue and not currently
    reachable — nothing in the app calls this function — but the docstring
    overstates the guarantee, so it is pinned here.
    """
    rendered = like_literal(value)
    assert rendered == f"'%{value}%'"
    assert "\\" not in rendered
