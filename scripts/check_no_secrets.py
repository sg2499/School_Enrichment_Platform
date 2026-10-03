#!/usr/bin/env python3
"""Refuses a commit that carries key material (3 Oct 2026).

Why this exists. On 1 Oct 2026 a file called top_encryption_key.txt -- a
backup of a real Fernet key, saved into the repo folder -- was committed to
this public repository in PR #79. Both guards that should have stopped it
looked the other way:

  * ship.ps1 ran its secret check BEFORE `git add -A`, using `git diff`,
    which never lists an untracked file. A brand-new file was therefore
    never examined at all, and was then swept in by `git add -A`. (The same
    route a stray *.patch file took on 30 Sep.)
  * Both ship.ps1 and CI only matched file NAMES against a short list
    (.env, *.pem, *.key, ...). "top_encryption_key.txt" ends in .txt.

So this script checks what those could not: every file that is about to be
committed, new ones included, by name AND by content. ship.ps1 runs it on
the staged set after `git add -A`; CI runs it on the whole tracked tree on
every push, which also catches anything that predates the guard.

It is one script used by both so the local check and the CI check cannot
drift apart again -- before this, the same regex was pasted into two files.

A finding never prints the value it found: only the path, the line number
and the name of the rule. This output goes to a public CI log.

Usage:
  python scripts/check_no_secrets.py --staged   # what `git commit` would take
  python scripts/check_no_secrets.py --all      # every tracked file at HEAD

Exit code 0 when clean, 1 when anything is found, 2 if git itself failed.
No third-party imports: it has to run in CI before any dependency install,
and on a machine where the virtualenv isn't active.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import re
import subprocess
import sys

# --- names ---------------------------------------------------------------------
# The first group is the list ship.ps1 and ci.yml carried before. The rest
# are the shapes a key backup actually takes when a person saves one.
SECRET_PATH = re.compile(
    r"""(^|/)(
        \.env($|\.)                         # .env, .env.local, .env.production
      | [^/]*\.(pem|key|p12|pfx|jks|keystore)$
      | id_(rsa|dsa|ecdsa|ed25519)$
      | credentials\.json$
      | secrets?\.[^/]*$                    # secret.txt, secrets.yaml
      | [^/]*(encryption|secret|private|signing|api|operator|platform)[_-]?keys?
            [^/]*\.(txt|json|ya?ml|env|md|csv|bak)$   # top_encryption_key.txt
      | [^/]*[_-]keys?\.(txt|bak)$          # my_key.txt, backup-keys.txt
    )""",
    re.IGNORECASE | re.VERBOSE,
)
# Checked-in templates are the one deliberate exception: they hold
# placeholder values and exist so nobody needs to pass a real .env around.
ALLOWED_PATH = re.compile(r"(^|/)\.env\.example$")

# --- contents ------------------------------------------------------------------
# 43 url-safe base64 characters and one "=": 32 bytes, which is what
# Fernet.generate_key() prints and what TOTP_ENCRYPTION_KEY holds. The
# lookarounds keep it from matching the middle of a longer token (a 64-byte
# hash, a JWT).
FERNET_SHAPE = re.compile(r"(?<![A-Za-z0-9_\-+/=])[A-Za-z0-9_\-]{43}=(?![A-Za-z0-9_\-+/=])")

# Two 32-byte keys are in the repo on purpose and are public by design. They
# are listed by SHA-256 so that this file does not itself contain a key, and
# so that the exemption is for those two exact values, not for the files
# they live in -- a real key pasted into config.py is still caught.
ALLOWED_KEY_SHA256 = {
    # backend/app/core/config.py, _DEV_TOTP_ENCRYPTION_KEY: the local-dev
    # default; config.py refuses to start in production with it.
    "036d526ed70e2963d64406cdddb16998943367fdf4041893e1fd9e348fbd9cf2",
    # backend/tests/conftest.py, the test-only TOTP_ENCRYPTION_KEY.
    "cc301f77a3ebaba2ce1830f697e87abfac56126fe75cf8687afaa9855b52ac76",
}

CONTENT_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("a private key block", re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")),
    ("a GitHub token", re.compile(r"\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b")),
    ("an AWS access key id", re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("a Render API key", re.compile(r"\brnd_[A-Za-z0-9]{28,}\b")),
    ("a Stripe live key", re.compile(r"\b(sk|rk)_live_[A-Za-z0-9]{20,}\b")),
    (
        # A connection string with a real password to a real host. Local and
        # placeholder hosts are how .env.example and the docs show the format.
        "a database URL with a password",
        re.compile(
            r"\bpostgres(?:ql)?(?:\+\w+)?://[^\s:/@'\"]+:(?!\s|<|\$|\{|password\b|postgres\b|example\b|changeme\b)"
            r"[^\s@'\"]{6,}@(?!localhost\b|127\.0\.0\.1\b|db\b|postgres\b|host\b|example\b|<)[\w.\-]+",
            re.IGNORECASE,
        ),
    ),
]

# Lockfiles and build output are machine-written, large, and full of
# hash-shaped strings that are not secrets.
SKIP_CONTENT = re.compile(r"(^|/)(package-lock\.json|tsconfig\.tsbuildinfo|.*\.lock|.*\.min\.(js|css)|.*\.map)$")
MAX_CONTENT_BYTES = 2_000_000


def git(*args: str) -> bytes:
    result = subprocess.run(["git", *args], capture_output=True, check=False)
    if result.returncode != 0:
        sys.stderr.write(result.stderr.decode("utf-8", "replace"))
        raise SystemExit(2)
    return result.stdout


def paths_to_check(mode: str) -> list[str]:
    if mode == "staged":
        # A = added, C = copied, M = modified, R = renamed. Deleted files
        # are left out on purpose: removing a key file must not be blocked
        # by the rule that says it should never have been there.
        raw = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    else:
        raw = git("ls-files", "-z")
    return [path for path in raw.decode("utf-8", "replace").split("\0") if path]


def read(path: str) -> bytes | None:
    # The version in git's index, never whatever is on disk: the check is
    # about what a commit would take. With --staged that is the staged
    # content; with --all on a clean checkout (CI) it is HEAD's.
    result = subprocess.run(["git", "cat-file", "blob", f":{path}"], capture_output=True, check=False)
    return result.stdout if result.returncode == 0 else None


def is_fernet_key(candidate: str) -> bool:
    try:
        return len(base64.urlsafe_b64decode(candidate.encode("ascii"))) == 32
    except (binascii.Error, ValueError):
        return False


def scan_content(text: str) -> list[tuple[int, str]]:
    findings: list[tuple[int, str]] = []
    for number, line in enumerate(text.splitlines(), start=1):
        for match in FERNET_SHAPE.finditer(line):
            value = match.group(0)
            if not is_fernet_key(value):
                continue
            if hashlib.sha256(value.encode("ascii")).hexdigest() in ALLOWED_KEY_SHA256:
                continue
            findings.append((number, "a 32-byte base64 key (the shape of a Fernet / TOTP_ENCRYPTION_KEY value)"))
        for name, pattern in CONTENT_RULES:
            if pattern.search(line):
                findings.append((number, name))
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Refuse a commit that carries key material.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--staged", action="store_const", const="staged", dest="mode")
    group.add_argument("--all", action="store_const", const="all", dest="mode")
    mode = parser.parse_args().mode

    paths = paths_to_check(mode)
    problems: list[str] = []
    for path in paths:
        if SECRET_PATH.search(path) and not ALLOWED_PATH.search(path):
            problems.append(f"{path}: the file name says it holds a secret")
            continue  # no need to open it, and better not to
        if SKIP_CONTENT.search(path):
            continue
        blob = read(path)
        if blob is None or len(blob) > MAX_CONTENT_BYTES or b"\0" in blob[:8000]:
            continue  # unreadable, very large, or binary
        for number, rule in scan_content(blob.decode("utf-8", "replace")):
            problems.append(f"{path}:{number}: looks like {rule}")

    scope = "staged files" if mode == "staged" else "tracked files"
    if problems:
        print(f"Secret check FAILED ({len(problems)} finding(s) in {len(paths)} {scope}):", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        print(
            "\nNothing above prints the value itself. If one of these is real: move the file out of\n"
            "the repository folder (or remove the value from the file), and if it was ever pushed,\n"
            "replace the key -- deleting it does not remove it from git history.\n"
            "If it is a deliberate public placeholder, add its SHA-256 to ALLOWED_KEY_SHA256 in\n"
            "scripts/check_no_secrets.py with a comment saying why.",
            file=sys.stderr,
        )
        return 1
    print(f"Secret check passed: {len(paths)} {scope}, no secret-bearing names or contents.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
