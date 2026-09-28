@echo off
REM ============================================================
REM Start-CFO-Sync.bat
REM Runs the full Zoho Books sync. Designed to be called by
REM Windows Task Scheduler on a recurring basis (e.g. every 4 hours).
REM
REM SETUP (one-time):
REM 1. Open Task Scheduler (search "Task Scheduler" in Start menu)
REM 2. Click "Create Task" (not "Create Basic Task" - need more options)
REM 3. General tab: Name it "CFO Tower Sync". Check "Run whether
REM    user is logged on or not" if you want it to run even when
REM    you're not at the PC.
REM 4. Triggers tab: New -> Daily, recur every 1 day, repeat task
REM    every 4 hours for a duration of 1 day (this gives you a
REM    sync every 4 hours, all day).
REM 5. Actions tab: New -> Start a program -> browse to THIS file
REM    (Start-CFO-Sync.bat)
REM 6. Conditions tab: uncheck "Start only if on AC power" if this
REM    is a laptop you sometimes run on battery.
REM 7. Save. Right-click the task -> Run, to test it once manually.
REM
REM Logs land in sync_log.txt next to this file, so you can check
REM what happened on any scheduled run without watching it live.
REM ============================================================

cd /d "F:\Visual Code Directory\APNJ-LLM-Studio"
call "F:\Visual Code Directory\RAG-Anything\venv\Scripts\activate.bat"

echo ============================================ >> sync_log.txt
echo Sync started: %date% %time% >> sync_log.txt
python -m cfo_tower.integrations.sync_all >> sync_log.txt 2>&1
echo Sync finished: %date% %time% >> sync_log.txt
echo ============================================ >> sync_log.txt
