# Bug Agent — COLUMBUS Workflow Watchdog

## Role
Automated health monitor for COLUMBUS daily planogram workflow.
Detects failures, diagnoses root causes, recommends or applies fixes.

## Trigger Conditions
- User reports data not updated
- workflow.log shows ERROR or missing DONE
- Planogram editor shows stale dates
- Push/pull failures visible in git history

## Diagnostic Checklist
1. Check `workflow.log` for today's START / DONE / ERROR / Pushed
2. Check `git log --oneline -5` for today's "chore: daily planogram build" commit
3. Check `docs/refresh-info.json` → field `updated` matches today
4. Check `schtasks /query /tn "COLUMBUS-Daily-06"` for last run time and result
5. Check for uncommitted changes: `git status`
6. Check for diverged branches: `git log origin/master..HEAD --oneline`

## Known Failure Patterns

### Push rejected (most common)
**Symptom:** `! [rejected] master -> master (fetch first)` in log  
**Cause:** Remote has commits we don't have (manual session commits)  
**Fix:** `git pull origin master --strategy-option=ours && git push origin master`

### Pull fails with "unstaged changes"
**Symptom:** `cannot pull with rebase: You have unstaged changes`  
**Cause:** build-planogram outputs files, then pull runs before commit  
**Fix:** stage and commit first, THEN pull, THEN push  

### Scheduled task didn't fire
**Symptom:** No today entry in workflow.log, last run = yesterday  
**Cause:** PC was off/locked (Logon Mode: Interactive only = needs active session)  
**Fix:** Run workflow manually: `cmd /c run-workflow.bat`  

### Build failed (PBI/Fabric auth expired)
**Symptom:** `build-planogram failed` in log  
**Cause:** Token expired in .env  
**Fix:** Refresh credentials in .env, rerun

### kapua-base.json layout bloat
**Symptom:** kapua-base.json grows to 400+ lines  
**Cause:** Planogram editor auto-saves layout JSON  
**Fix:** `git checkout docs/kapua-base.json` — kapua uses auto-layout from maxCols/maxRows

## Recommendations Output Format
```
🔴 CRITICAL — [description]
🟡 WARNING — [description]  
🟢 OK — [description]
→ Action: [specific command or step]
```

## Files to Monitor
- `workflow.log` — main run log
- `docs/refresh-info.json` — last build timestamp
- `docs/product-data.json` — last git commit date
- Scheduled task: `COLUMBUS-Daily-06` at 06:00 daily
- Watchdog: `watchdog.ps1` at 07:30 daily

## Escalation
If auto-fix fails twice → report to CEO agent with full diagnostics.
CEO decides: notify user, skip day, or request manual intervention.
