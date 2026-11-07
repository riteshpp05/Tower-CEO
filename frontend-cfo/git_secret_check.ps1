# git_secret_check.ps1
# Run from APNJ-LLM-Studio. Gives an unambiguous, clearly-labeled answer
# to: is .env tracked right now, was it ever committed in the past, and
# has this repo ever been pushed to a remote (which would mean any
# leaked secret is already off your machine, not just in local history).

Write-Host "=== 1. Is .env tracked in the CURRENT commit? ===" -ForegroundColor Cyan
$tracked = git ls-files | Select-String "^\.env$|/\.env$"
if ($tracked) {
    Write-Host "YES - .env is currently tracked:" -ForegroundColor Red
    $tracked
} else {
    Write-Host "No - .env is not in the current tracked file list." -ForegroundColor Green
}

Write-Host ""
Write-Host "=== 2. Was .env EVER committed, even if since removed? ===" -ForegroundColor Cyan
$history = git log --all --full-history --oneline -- .env
if ($history) {
    Write-Host "YES - .env appears in these commits:" -ForegroundColor Red
    $history
    Write-Host ""
    Write-Host "Commit count: $($history.Count)"
} else {
    Write-Host "No - .env does not appear anywhere in git history." -ForegroundColor Green
}

Write-Host ""
Write-Host "=== 3. Has this repo EVER been pushed to a remote? ===" -ForegroundColor Cyan
$remotes = git remote -v
if ($remotes) {
    Write-Host "Remote(s) configured:" -ForegroundColor Yellow
    $remotes
    Write-Host ""
    Write-Host "This does NOT confirm a push happened, just that a remote exists."
    Write-Host "Checking push history..."
    git log --all --source --remotes 2>$null | Select-Object -First 5
} else {
    Write-Host "No remote configured at all - this repo has never been pushed anywhere. Good, this is the simplest case to fix." -ForegroundColor Green
}

Write-Host ""
Write-Host "=== 4. .gitignore contents (the .env-related lines) ===" -ForegroundColor Cyan
Get-Content .gitignore | Select-String "env"

Write-Host ""
Write-Host "=== SUMMARY ===" -ForegroundColor Cyan
if ($tracked -or $history) {
    Write-Host "ACTION NEEDED before pushing anywhere. See next steps." -ForegroundColor Red
} else {
    Write-Host "Clean - .env has never been tracked or committed. Safe to proceed." -ForegroundColor Green
}
