"""Capture the project's mechanical state into SESSION_LOG/, for carry-over.

READ-ONLY with respect to the repo and the database. It writes exactly one
file, under `SESSION_LOG/`, and nothing else.

    python backend/scripts/project_snapshot.py              # from the repo root
    python backend/scripts/project_snapshot.py --topic a012  # names the file

WHY THIS EXISTS

There is no Claude memory on this account, and several chat threads run at
once. Every carry-over therefore depends on something being written down --
and on 25 Nov 2026 three numbers written down from memory were wrong in a
single day:

  * "~110" A-004 answers, when the review workbook said 191 in 14 families
    (and the right figure was already in the project's own 23 Nov entry);
  * "60" stray character names, when production held 480 across eight
    chapters;
  * "952" backend tests, when the real figure was 954 -- the 952 came from a
    stale background run.

Each was a recalled figure rather than a measured one. So: measure. Facts
from a script beat facts from memory, and this one costs a second.

WHAT IT RECORDS

Only what it can establish mechanically: the commit and branch, whether the
tree is clean, untracked files, test counts if asked for, and the Alembic
head. It deliberately does NOT try to summarise decisions or open questions
-- a human or a chat writes those into the same file underneath, which is why
the file ends with a blank section to fill in.
"""

import argparse
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def _run(cmd: list[str], cwd: Path) -> tuple[int, str]:
    try:
        # check=False on purpose: a non-zero exit is information to record,
        # not a reason to stop the snapshot.
        p = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, timeout=120, check=False
        )
        return p.returncode, (p.stdout or p.stderr or "").strip()
    except FileNotFoundError:
        return 127, f"not found: {cmd[0]}"
    except subprocess.TimeoutExpired:
        return 124, "timed out"


def _find_repo_root(start: Path) -> Path | None:
    for candidate in [start, *start.parents]:
        if (candidate / ".git").exists():
            return candidate
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--topic", default="", help="short slug for the filename")
    parser.add_argument(
        "--with-tests",
        action="store_true",
        help="also run the backend suite and record the count (slow, ~9 min)",
    )
    args = parser.parse_args()

    here = Path(__file__).resolve()
    repo = _find_repo_root(here)
    if repo is None:
        print("Could not find the repository root (no .git above this script).")
        return 2
    # SESSION_LOG lives beside the checkout, in the School Enrichment folder,
    # so it is never committed and never collides with the repo's history.
    project_folder = repo.parent
    log_dir = project_folder / "SESSION_LOG"
    log_dir.mkdir(exist_ok=True)

    now = datetime.now().astimezone()
    stamp = now.strftime("%Y-%m-%d_%H%M")
    slug = "".join(c if c.isalnum() or c in "-_" else "-" for c in args.topic).strip("-")
    name = f"{stamp}{'_' + slug if slug else ''}.md"
    out = log_dir / name

    lines: list[str] = []
    add = lines.append

    add(f"# Session snapshot — {now:%d %b %Y, %H:%M %Z}")
    add("")
    add("Captured by `backend/scripts/project_snapshot.py`. Everything above the")
    add("\"Written by hand\" heading is measured, not recalled.")
    add("")
    add("## Measured")
    add("")

    for label, cmd in (
        ("commit", ["git", "log", "--oneline", "-1"]),
        ("branch", ["git", "rev-parse", "--abbrev-ref", "HEAD"]),
        ("full SHA", ["git", "rev-parse", "HEAD"]),
        ("last 3 commits", ["git", "log", "--oneline", "-3"]),
    ):
        code, text = _run(cmd, repo)
        add(f"- **{label}:** " + (text.replace("\n", " · ") if code == 0 else f"(failed: {text})"))

    code, status = _run(["git", "status", "--short"], repo)
    if code == 0 and not status:
        add("- **working tree:** clean")
    elif code == 0:
        add("- **working tree:** NOT clean —")
        for line in status.splitlines():
            add(f"    - `{line}`")
    else:
        add(f"- **working tree:** (failed: {status})")

    code, untracked = _run(["git", "ls-files", "--others", "--exclude-standard"], repo)
    if code == 0:
        files = [f for f in untracked.splitlines() if f.strip()]
        add(f"- **untracked files:** {len(files)}")
        for f in files[:40]:
            add(f"    - `{f}`")

    # `python -m alembic` does not work -- alembic is a package with no
    # __main__ -- so call the console script, which the venv provides.
    code, head = _run(["alembic", "heads"], repo / "backend")
    add("- **alembic head:** " + (head.replace("\n", " · ") if code == 0 else f"(not read: {head.splitlines()[0] if head else '?'})"))

    if args.with_tests:
        code, text = _run([sys.executable, "-m", "pytest", "-q", "--no-header"], repo / "backend")
        tail = [line for line in text.splitlines() if "passed" in line or "failed" in line]
        add("- **backend tests:** " + (tail[-1] if tail else f"(could not read: {code})"))
    else:
        add("- **backend tests:** not run (pass `--with-tests` to measure)")

    add("")
    add("## Written by hand — fill this in before the chat closes")
    add("")
    add("Keep it factual and short. What a later thread needs is what changed, what")
    add("is now true that was not, what was decided and why, what is still open, and")
    add("anything that was believed and turned out to be wrong.")
    add("")
    add("- **What this stretch of work did:**")
    add("- **Decisions taken, and by whom:**")
    add("- **Still open / waiting on whom:**")
    add("- **Anything I got wrong, and what corrected it:**")
    add("- **Shared documents I edited (if any), so no other chat clobbers them:**")
    add("")

    out.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"Snapshot written: {out}")
    print()
    print("\n".join(lines[: lines.index("## Written by hand — fill this in before the chat closes")]))
    print("Now fill in the \"Written by hand\" section before this chat closes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
