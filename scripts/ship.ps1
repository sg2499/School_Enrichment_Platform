#requires -version 5.1
<#
.SYNOPSIS
    School Enrichment — one-command ship workflow: branch, local-verify, commit, push, PR, wait for CI.

.DESCRIPTION
    Mirrors exactly what CI (.github/workflows/ci.yml) checks, but runs it locally FIRST so nothing
    surprises you after pushing. Never merges on its own — merging is always a deliberate final
    step you run yourself (or pass -AutoMerge if you're confident enough to skip that pause).

    Requires: git, GitHub CLI (gh) authenticated (`gh auth login`), Python 3.11+ on PATH for the
    backend checks, Node 20+ on PATH for the frontend checks.

.PARAMETER Branch
    Name for the feature branch, e.g. "phase1-auth-scaffolding". Created if it doesn't exist yet,
    checked out if it does.

.PARAMETER Message
    Commit message / PR title. Keep it in "type: what changed" form, e.g.
    "feat: bootstrap FastAPI/Next.js scaffolding from MathPath fork".

.PARAMETER AutoMerge
    If set, merges automatically the moment ci-summary passes (squash + delete branch, no admin
    bypass — it still can't merge if CI is red). Default is off: the script stops after CI passes
    and prints the exact merge command for you to run when you're ready.

.EXAMPLE
    .\scripts\ship.ps1 -Branch "phase1-auth-scaffolding" -Message "feat: bootstrap auth from MathPath fork"
#>

param(
    [Parameter(Mandatory = $true)][string]$Branch,
    [Parameter(Mandatory = $true)][string]$Message,
    [switch]$AutoMerge
)

$ErrorActionPreference = "Stop"

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "    $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    $text" -ForegroundColor Yellow }

# --- Sanity checks -----------------------------------------------------
Step "Checking prerequisites"
foreach ($tool in @("git", "gh")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool is not on PATH. Install it before running this script."
    }
}
gh auth status *>$null
if ($LASTEXITCODE -ne 0) { throw "Not logged into GitHub CLI. Run 'gh auth login' first." }
Ok "git and gh present, gh authenticated."

# --- Branch --------------------------------------------------------------
Step "Branch: $Branch"
git rev-parse --verify $Branch *>$null
if ($LASTEXITCODE -eq 0) {
    git checkout $Branch
} else {
    git checkout -b $Branch
}
Ok "On branch $Branch."

# --- Local verification, mirrors ci.yml exactly ---------------------------
# If this fails, fix it BEFORE pushing -- don't let CI be the first place a
# broken build shows up.
if (Test-Path "backend/requirements.txt") {
    Step "Backend: pytest (mirrors the backend-tests CI job)"
    Push-Location backend
    try {
        python -m pytest tests -q
        if ($LASTEXITCODE -ne 0) { throw "Backend tests failed. Not pushing." }
        Ok "Backend tests passed."
    } finally { Pop-Location }
}

if (Test-Path "frontend/package.json") {
    Step "Frontend: typecheck (mirrors the frontend-typecheck CI job)"
    Push-Location frontend
    try {
        npm run typecheck
        if ($LASTEXITCODE -ne 0) { throw "Frontend typecheck failed. Not pushing." }
        Ok "Typecheck passed."

        Step "Frontend: production build (mirrors the frontend-build CI job)"
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "Frontend build failed. Not pushing." }
        Ok "Build passed."
    } finally { Pop-Location }
}

# --- Secret scan, mirrors the repository-safety CI job -------------------
Step "Scanning staged changes for secret-bearing file paths"
$changed = git diff --name-only HEAD 2>$null
$changed += git diff --name-only --cached 2>$null
$suspicious = $changed | Where-Object {
    $_ -match '(^|/)(\.env($|\.)|.*\.pem$|.*\.key$|id_rsa$|credentials\.json$|secrets?\.)' -and
    $_ -notmatch '(^|/)\.env\.example$'
}
if ($suspicious) {
    Warn "These changed paths look secret-bearing:"
    $suspicious | ForEach-Object { Warn "  $_" }
    throw "Refusing to push. Remove secrets from the diff first."
}
Ok "No secret-bearing paths in the diff."

# --- Commit and push -------------------------------------------------------
Step "Committing"
git add -A
git commit -m "$Message"
Ok "Committed."

Step "Pushing to origin/$Branch"
git push -u origin $Branch
Ok "Pushed."

# --- Open PR (uses .github/pull_request_template.md interactively) --------
Step "Opening pull request"
$existing = gh pr view $Branch --json url 2>$null
if ($LASTEXITCODE -eq 0) {
    Warn "PR already exists for this branch."
} else {
    gh pr create --title "$Message" --base main --head $Branch
}

# --- Wait for CI ------------------------------------------------------------
Step "Waiting for CI (ci-summary must pass before this can merge)"
gh pr checks $Branch --watch
if ($LASTEXITCODE -ne 0) {
    throw "CI failed or is still red. Fix it, re-run this script, and it'll push the fix to the same PR."
}
Ok "All required checks passed."

# --- Merge -------------------------------------------------------------------
if ($AutoMerge) {
    Step "Merging (squash, delete branch, no admin bypass)"
    gh pr merge $Branch --squash --delete-branch
    Ok "Merged. Vercel/Render will auto-deploy from main."
} else {
    Write-Host ""
    Write-Host "CI is green. Review the PR, then merge with:" -ForegroundColor Green
    Write-Host "    gh pr merge $Branch --squash --delete-branch" -ForegroundColor Green
    Write-Host "(Pass -AutoMerge next time to skip this pause once you trust the flow.)" -ForegroundColor DarkGray
}
