"""Unit coverage for the 2026-08-19 password-policy hardening in
app/core/security.py's strong_password_issue() -- specifically the new
common-password/pattern rejection layered on top of the pre-existing
length/character-class rules.
"""
import pytest

from app.core.security import strong_password_issue


@pytest.mark.parametrize(
    "password",
    [
        "Password1",
        "password123",
        "P@ssw0rd1",
        "Welcome123",
        "Admin1234",
        "LetMeIn123",
        "iloveyou1",
        "Qwerty123",
        "Trustno1",
        "Sunshine1",
    ],
)
def test_common_word_based_passwords_are_rejected(password):
    assert strong_password_issue(password) is not None


@pytest.mark.parametrize(
    "password",
    [
        "12345678",
        "123456789",
        "87654321",
        "abcdefgh",
        "aaaaaaaa",
        "11111111",
    ],
)
def test_sequential_and_repeated_patterns_are_rejected(password):
    assert strong_password_issue(password) is not None


@pytest.mark.parametrize(
    "password",
    [
        "Xk4$nQ8vPz",
        "Tr0ubad0ur&7",
        "Mn7#qLp2xR",
        "Fj9!wKd4mB",
    ],
)
def test_genuinely_strong_passwords_are_accepted(password):
    assert strong_password_issue(password) is None


def test_still_enforces_original_length_and_character_class_rules():
    assert strong_password_issue("short1") is not None  # too short
    assert strong_password_issue("nodigitshere") is not None  # no digit
    assert strong_password_issue("12345678") is not None  # no letter (also sequential)
