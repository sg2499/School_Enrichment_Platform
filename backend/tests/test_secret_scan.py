"""scripts/check_no_secrets.py -- the guard ship.ps1 runs before every commit
and CI runs on every push.

These run the real script against a real (throwaway) git repository, because
the bug it exists to prevent was about git, not about regexes: on 1 Oct 2026
a key backup saved as top_encryption_key.txt was committed to this public
repo because the old check looked at `git diff`, which never lists an
untracked file, and matched names only.

Every key in this file is generated when the test runs. None is, or ever
was, a real one -- and no key literal appears here, so this file passes the
scan it tests.
"""
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "check_no_secrets.py"

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="needs the git command")


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "config", "user.email", "test@example.com")
    _git(tmp_path, "config", "user.name", "Test")
    _git(tmp_path, "config", "commit.gpgsign", "false")
    (tmp_path / "README.md").write_text("# A project\n")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-q", "-m", "start")
    return tmp_path


def _scan(repo: Path, mode: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPT), mode], cwd=repo, capture_output=True, text=True, check=False)


def _new_key() -> str:
    return Fernet.generate_key().decode("ascii")


def test_the_file_that_got_through_is_now_refused(repo):
    # Exactly what happened: a new, untracked key backup in the repo root,
    # then ship.ps1's `git add -A`.
    key = _new_key()
    (repo / "top_encryption_key.txt").write_text(key + "\n")
    _git(repo, "add", "-A")

    result = _scan(repo, "--staged")
    assert result.returncode == 1
    assert "top_encryption_key.txt: the file name says it holds a secret" in result.stderr
    assert key not in result.stdout + result.stderr


def test_a_key_is_caught_by_its_contents_whatever_the_file_is_called(repo):
    key = _new_key()
    (repo / "notes.txt").write_text(f"things to remember\n\nrender key: {key}\n")
    (repo / "settings.py").write_text(f'DEBUG = False\nTOTP_ENCRYPTION_KEY = "{key}"\n')
    _git(repo, "add", "-A")

    result = _scan(repo, "--staged")
    assert result.returncode == 1
    assert "notes.txt:3: looks like a 32-byte base64 key" in result.stderr
    assert "settings.py:2: looks like a 32-byte base64 key" in result.stderr
    assert key not in result.stdout + result.stderr


def test_ordinary_changes_pass(repo):
    (repo / "app.py").write_text("def add(a, b):\n    return a + b\n")
    (repo / "notes.md").write_text(
        "A 44-character line that is not a key: ============================================\n"
        "A commit: 95db0c2b7f1e4a6d8c9b0a1f2e3d4c5b6a798081\n"
        "postgresql://postgres:postgres@localhost:5432/school_enrichment\n"
        "DATABASE_URL=postgresql://user:password@host:5432/dbname\n"
    )
    _git(repo, "add", "-A")

    result = _scan(repo, "--staged")
    assert result.returncode == 0, result.stderr
    assert "Secret check passed: 2 staged files" in result.stdout


def test_the_two_deliberately_public_keys_are_allowed_by_value_not_by_file(repo):
    # config.py's dev default and conftest.py's test key are in the repo on
    # purpose. Copied here under their real paths, they pass...
    for relative in ("backend/app/core/config.py", "backend/tests/conftest.py"):
        target = repo / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(REPO_ROOT / relative, target)
    _git(repo, "add", "-A")
    assert _scan(repo, "--staged").returncode == 0

    # ...but the exemption is for those two values, not for those files: a
    # different key added to config.py is still refused.
    with (repo / "backend/app/core/config.py").open("a") as handle:
        handle.write(f'\n_OTHER_KEY = "{_new_key()}"\n')
    _git(repo, "add", "-A")
    result = _scan(repo, "--staged")
    assert result.returncode == 1
    assert "backend/app/core/config.py" in result.stderr


def test_removing_a_committed_key_file_is_not_blocked_by_the_rule_against_it(repo):
    (repo / "top_encryption_key.txt").write_text(_new_key() + "\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "the mistake")
    # --all sees it in the tree: this is CI catching one that predates the guard.
    assert _scan(repo, "--all").returncode == 1

    _git(repo, "rm", "-q", "top_encryption_key.txt")
    assert _scan(repo, "--staged").returncode == 0
    _git(repo, "commit", "-q", "-m", "remove it")
    assert _scan(repo, "--all").returncode == 0


@pytest.mark.parametrize(
    "name",
    [
        ".env",
        "backend/.env.production",
        "certs/server.pem",
        "deploy.key",
        "id_ed25519",
        "credentials.json",
        "secrets.yaml",
        "render_api_key.txt",
        "PLATFORM-OPERATOR-KEY.md",
        "backup-keys.txt",
    ],
)
def test_names_that_say_secret_are_refused_without_being_opened(repo, name):
    target = repo / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("nothing that looks like a key in here\n")
    # -f: several of these names are (rightly) in a real .gitignore; this
    # proves the scan stands on its own if a file is force-added.
    _git(repo, "add", "-f", name)

    result = _scan(repo, "--staged")
    assert result.returncode == 1
    assert f"{name}: the file name says it holds a secret" in result.stderr


@pytest.mark.parametrize(
    "name",
    [".env.example", "backend/.env.example", "frontend/lib/hotkeys.ts", "docs/keyboard.md", "backend/app/core/totp_crypto.py"],
)
def test_names_that_only_sound_similar_are_left_alone(repo, name):
    target = repo / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("SECRET_KEY=change-me\n")
    _git(repo, "add", "-f", name)
    assert _scan(repo, "--staged").returncode == 0


@pytest.mark.parametrize(
    ("line", "rule"),
    [
        ("-----BEGIN " + "RSA PRIVATE KEY-----", "a private key block"),
        ("-----BEGIN " + "PRIVATE KEY-----", "a private key block"),
        ("token = gh" + "p_" + "a" * 36, "a GitHub token"),
        ("aws_access_key_id = AKI" + "A" + "ABCDEFGHIJKLMNOP", "an AWS access key id"),
        ("RENDER_API_KEY=rn" + "d_" + "b" * 32, "a Render API key"),
        (
            "DATABASE_URL=postgresql://school_admin:" + "Xk29fQp7Lm" + "@dpg-abc123-a.singapore-postgres.render.com/school",
            "a database URL with a password",
        ),
    ],
)
def test_other_kinds_of_secret_are_recognised(repo, line, rule):
    # Each sample is assembled from pieces so that this file itself never
    # contains a line the scan would refuse.
    (repo / "deploy_notes.txt").write_text(f"first line\n{line}\n")
    _git(repo, "add", "-A")

    result = _scan(repo, "--staged")
    assert result.returncode == 1
    assert f"deploy_notes.txt:2: looks like {rule}" in result.stderr
