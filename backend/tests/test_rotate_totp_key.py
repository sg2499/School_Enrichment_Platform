"""scripts/rotate_totp_key.py -- the step that makes replacing a leaked
TOTP_ENCRYPTION_KEY safe.

Runs the real rotate() against a throwaway SQLite table shaped like the
users columns it touches. Every key and secret is generated when the test
runs; none is real and no key literal appears in this file.
"""
import importlib.util
import sys
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import create_engine, text

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "rotate_totp_key.py"
spec = importlib.util.spec_from_file_location("rotate_totp_key", SCRIPT)
rotate_totp_key = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = rotate_totp_key  # dataclasses looks its module up here
spec.loader.exec_module(rotate_totp_key)
RotationError = rotate_totp_key.RotationError


def _key() -> str:
    return Fernet.generate_key().decode("ascii")


def _seal(key: str, secret: str) -> str:
    return Fernet(key.encode("ascii")).encrypt(secret.encode("utf-8")).decode("ascii")


def _open(key: str, token: str) -> str:
    return Fernet(key.encode("ascii")).decrypt(token.encode("ascii")).decode("utf-8")


@pytest.fixture()
def engine():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(
            text("CREATE TABLE users (id INTEGER PRIMARY KEY, totp_secret TEXT, totp_pending_secret TEXT)")
        )
    return engine


def _insert(engine, user_id, secret=None, pending=None):
    with engine.begin() as connection:
        connection.execute(
            text("INSERT INTO users (id, totp_secret, totp_pending_secret) VALUES (:i, :s, :p)"),
            {"i": user_id, "s": secret, "p": pending},
        )


def _row(engine, user_id):
    with engine.connect() as connection:
        return connection.execute(
            text("SELECT totp_secret, totp_pending_secret FROM users WHERE id = :i"), {"i": user_id}
        ).one()


def test_old_secrets_are_re_encrypted_under_the_new_key_alone(engine):
    old, new = _key(), _key()
    _insert(engine, 1, secret=_seal(old, "JBSWY3DPEHPK3PXP"))
    _insert(engine, 2, secret=_seal(old, "KRSXG5CTMVRXEZLU"), pending=_seal(old, "MFRGGZDFMZTWQ2LK"))
    _insert(engine, 3)  # a teacher: no 2FA at all

    with engine.begin() as connection:
        report = rotate_totp_key.rotate(connection, new, old, apply=True)

    assert (report.accounts, report.secrets, report.to_rotate, report.rotated) == (2, 3, 3, 2)
    # Opens with the NEW key alone, to the same secret, and no longer with the old one.
    assert _open(new, _row(engine, 1)[0]) == "JBSWY3DPEHPK3PXP"
    assert _open(new, _row(engine, 2)[0]) == "KRSXG5CTMVRXEZLU"
    assert _open(new, _row(engine, 2)[1]) == "MFRGGZDFMZTWQ2LK"
    with pytest.raises(Exception):  # noqa: B017 -- InvalidToken
        _open(old, _row(engine, 1)[0])
    assert _row(engine, 3) == (None, None)


def test_without_apply_nothing_is_written(engine):
    old, new = _key(), _key()
    token = _seal(old, "JBSWY3DPEHPK3PXP")
    _insert(engine, 1, secret=token)

    with engine.begin() as connection:
        report = rotate_totp_key.rotate(connection, new, old, apply=False)

    assert (report.secrets, report.to_rotate, report.rotated) == (1, 1, 0)
    assert _row(engine, 1)[0] == token


def test_running_it_twice_is_harmless(engine):
    old, new = _key(), _key()
    _insert(engine, 1, secret=_seal(old, "JBSWY3DPEHPK3PXP"))
    with engine.begin() as connection:
        rotate_totp_key.rotate(connection, new, old, apply=True)
    after_first = _row(engine, 1)[0]

    with engine.begin() as connection:
        report = rotate_totp_key.rotate(connection, new, old, apply=True)

    assert (report.already_current, report.to_rotate) == (1, 0)
    assert _row(engine, 1)[0] == after_first  # untouched, not re-encrypted again


def test_one_unreadable_secret_stops_everything_before_any_change(engine):
    old, new, stranger = _key(), _key(), _key()
    good = _seal(old, "JBSWY3DPEHPK3PXP")
    foreign = _seal(stranger, "KRSXG5CTMVRXEZLU")  # under a key the operator did not supply
    _insert(engine, 1, secret=good)
    _insert(engine, 2, secret=foreign)

    with pytest.raises(RotationError, match="1 stored secret"), engine.begin() as connection:
        rotate_totp_key.rotate(connection, new, old, apply=True)

    assert _row(engine, 1)[0] == good  # the readable one was not rotated either
    assert _row(engine, 2)[0] == foreign


def test_a_value_that_was_never_encrypted_is_refused_not_wrapped(engine):
    old, new = _key(), _key()
    _insert(engine, 1, secret="JBSWY3DPEHPK3PXP")  # plaintext, as before the encryption migration

    with pytest.raises(RotationError), engine.begin() as connection:
        rotate_totp_key.rotate(connection, new, old, apply=True)
    assert _row(engine, 1)[0] == "JBSWY3DPEHPK3PXP"


def test_a_failed_check_after_writing_rolls_the_whole_run_back(engine, monkeypatch):
    old, new = _key(), _key()
    token = _seal(old, "JBSWY3DPEHPK3PXP")
    _insert(engine, 1, secret=token)
    # Make the read-back disagree: the read-back opens with the new key alone
    # (a ring of one); the planning pass uses the whole ring.
    real = rotate_totp_key._plaintext
    monkeypatch.setattr(
        rotate_totp_key, "_plaintext", lambda token, ring: "SOMETHINGELSE" if len(ring) == 1 else real(token, ring)
    )

    with pytest.raises(RotationError, match="rolled back"), engine.begin() as connection:
        rotate_totp_key.rotate(connection, new, old, apply=True)

    assert _row(engine, 1)[0] == token


def test_a_mixed_table_is_handled(engine):
    old, new = _key(), _key()
    already = _seal(new, "JBSWY3DPEHPK3PXP")  # enrolled after step 1 of the rotation
    _insert(engine, 1, secret=already)
    _insert(engine, 2, secret=_seal(old, "KRSXG5CTMVRXEZLU"))

    with engine.begin() as connection:
        report = rotate_totp_key.rotate(connection, new, old, apply=True)

    assert (report.already_current, report.to_rotate) == (1, 1)
    assert _row(engine, 1)[0] == already
    assert _open(new, _row(engine, 2)[0]) == "KRSXG5CTMVRXEZLU"


@pytest.mark.parametrize(
    ("new_key", "old_keys", "message"),
    [
        ("", "x", "new key is empty"),
        ("not-a-key", "", "new key is not a valid Fernet key"),
        (None, "", "new key is empty"),
    ],
)
def test_bad_keys_are_refused_with_a_plain_sentence(new_key, old_keys, message):
    with pytest.raises(RotationError, match=message):
        rotate_totp_key.build_keys(new_key, old_keys)


def test_a_malformed_old_key_is_named_by_position():
    with pytest.raises(RotationError, match="Old key #2"):
        rotate_totp_key.build_keys(_key(), f"{_key()}, nonsense")


def test_the_new_key_must_actually_be_new():
    same = _key()
    with pytest.raises(RotationError, match="same as one of the old keys"):
        rotate_totp_key.build_keys(same, f"{_key()},{same}")


def test_old_keys_may_be_several_and_padded_with_spaces(engine):
    older, old, new = _key(), _key(), _key()
    _insert(engine, 1, secret=_seal(older, "JBSWY3DPEHPK3PXP"))
    _insert(engine, 2, secret=_seal(old, "KRSXG5CTMVRXEZLU"))

    with engine.begin() as connection:
        rotate_totp_key.rotate(connection, new, f" {old} , {older} ", apply=True)

    assert _open(new, _row(engine, 1)[0]) == "JBSWY3DPEHPK3PXP"
    assert _open(new, _row(engine, 2)[0]) == "KRSXG5CTMVRXEZLU"


def test_the_report_never_contains_a_secret_or_a_key(engine):
    old, new = _key(), _key()
    _insert(engine, 1, secret=_seal(old, "JBSWY3DPEHPK3PXP"))
    with engine.begin() as connection:
        report = rotate_totp_key.rotate(connection, new, old, apply=True)
    rendered = repr(report)
    assert "JBSWY3DPEHPK3PXP" not in rendered and old not in rendered and new not in rendered
