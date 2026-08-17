# School Enrichment

CBSE/ICSE academic learning platform for Classes 5-10, standalone product
forked from the MathPath platform (code/architecture reference only --
separate repo, database, storage, and deployment; see `PROJECT_REFERENCE.md`
in the project's working folder for full context).

## Status

Phase 1 (Product separation / bootstrap) in progress. This is a stripped
baseline: FastAPI backend with auth/session/roles working end to end
against a `School -> Student/Teacher` identity model, and a Next.js
three-role shell (Student/Teacher/Admin) with placeholder navigation.
No curriculum content yet -- that starts in Phase 2 (Curriculum Studio).

See `PHASE_0_CODE_AUDIT.md` and `IMPLEMENTATION_ROADMAP.md` for what was
retained/refactored/replaced/removed from MathPath, and why.

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
