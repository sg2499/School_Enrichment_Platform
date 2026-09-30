# School Enrichment

CBSE/ICSE academic learning platform for Classes 5-10, standalone product
forked from the MathPath platform (code/architecture reference only --
separate repo, database, storage, and deployment; see `PROJECT_REFERENCE.md`
in the project's working folder for full context).

## Status

_Last reconciled: 30 Sep 2026 (A3 doc pass, PR #71 era)._

Phases 1-2 done, Phase 3 underway (see `IMPLEMENTATION_ROADMAP.md` for the
full phase plan -- that document itself still describes the pre-Phase-1
state as of this reconciliation and needs its own pass; treat this section
as the source of truth for what's actually built until then):

- **Phase 1 (Product separation)** -- done. Auth/session/roles working end
  to end against a `School -> Student/Teacher` identity model; three-role
  Next.js shell (Student/Teacher/Admin); CI/CD gate live (`CI_CD_SETUP.md`).
- **Phase 2 (Curriculum Studio)** -- done. Full curriculum data model
  (Board/Class/Subject/Chapter/Concept Lesson), draft/review/publish
  workflow, all 15 real Class 5 CBSE Maths chapters imported and live
  (`backend/scripts/import_class5_maths.py`), automated question-quality
  checks, school-to-curriculum mapping.
- **Phase 3 (Five-day learning loop)** -- underway. Assignment -> Attempt
  -> auto-marking -> Results lifecycle built and live for objective
  questions (numeric/text/ordering grading, unit/currency/sign-tolerant);
  student "Today's Practice" and teacher Assign/Results/per-question
  review UI shipped; teacher-section-assignment (who teaches which
  section) landed as the newest piece. Foundation Repair
  (prerequisite-based remediation) not yet built.
- **Phase 4 (School marking engine)** -- not started (HYBRID/MANUAL
  evaluation tiers, rubrics, partial marks are still open per
  `PHASE_0_CODE_AUDIT.md`'s "genuinely new work" list).
- **Phases 5-8** (paper/mock generator, analytics, content expansion,
  pilot hardening) -- not started.

Four accounts exist for manual verification against production (super
admin, MathPath-school admin, teacher, student) -- see
`backend/scripts/create_super_admin.py` and
`backend/scripts/reset_test_account_password.py` if any of them need a
password reset. Do not repurpose these for anything other than testing;
see the scripts' own docstrings.

See `PHASE_0_CODE_AUDIT.md` for what was retained/refactored/replaced/
removed from MathPath, and why (that document is a point-in-time Phase 0
audit and doesn't need updating as the project progresses).

## Repo layout

```
backend/    FastAPI + SQLAlchemy + Alembic
frontend/   Next.js 15 App Router + TypeScript + Tailwind
.github/    CI workflow, Dependabot, PR template
scripts/    ship.ps1 -- local push/PR/merge workflow (see CI_CD_SETUP.md)
render.yaml Render web service + Postgres blueprint
```

## Local development

Backend:
```
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1          # PowerShell
pip install -r requirements.txt
copy .env.example .env              # then edit as needed
alembic upgrade head
uvicorn app.main:app --reload
```

Backend tests:
```
cd backend
python -m pytest tests -q
```

Frontend:
```
cd frontend
npm install
npm run dev
```

## Shipping a change

Once this is pushed as the initial commit and branch protection is on
(see `CI_CD_SETUP.md`), day-to-day changes go through:

```
.\scripts\ship.ps1 -Branch "your-branch-name" -Message "feat: what changed"
```

This runs the same checks CI runs, locally, before pushing -- see the
script's own comment header and `CI_CD_SETUP.md` for the full rationale.
