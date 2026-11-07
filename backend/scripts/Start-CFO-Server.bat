@echo off
:: ============================================================
:: Start-CFO-Server.bat
:: Starts cfo_server.py (FastAPI backend on port 3002) for the
:: CFO Ops Control Tower chat widget and sync endpoints.
::
:: This is intentionally a SEPARATE script from the main LLM-stack
:: launcher -- cfo_server.py has its own lifecycle (you'll likely
:: restart it often while developing the chatbot, without wanting
:: to restart Qwen/Nomic/RAG Bridge/etc each time).
::
:: Window stays OPEN (not minimized) so you can see live logs and
:: errors. See the ALTERNATIVE block at the bottom if you later
:: want it to run minimized instead, like your other 5 servers.
:: ============================================================

title APNJ - CFO Server (DO NOT CLOSE)
color 0B
echo.
echo  ============================================================
echo   CFO Ops Control Tower — Backend Server
echo  ============================================================
echo.

:: ---- Step 1: stop any existing instance on port 3002 ----
:: Three plain, sequential attempts (rather than a GOTO loop) -- a
:: process that just received taskkill may take a moment to actually
:: release the port, so checking again after a short wait catches
:: that. Written as unrolled repeats instead of a loop construct to
:: avoid batch's well-known variable-scoping quirks inside loops.
echo  [1/3] Checking for an existing process on port 3002...

set FOUND_PID=
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3002 " 2^>nul') do set FOUND_PID=%%a
if not "%FOUND_PID%"=="" (
    echo       Found process %FOUND_PID% on port 3002 -- stopping it...
    taskkill /f /pid %FOUND_PID% >nul 2>&1
    timeout /t 2 /nobreak > nul
)

set FOUND_PID=
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3002 " 2^>nul') do set FOUND_PID=%%a
if not "%FOUND_PID%"=="" (
    echo       Still found process %FOUND_PID% on port 3002 -- stopping it...
    taskkill /f /pid %FOUND_PID% >nul 2>&1
    timeout /t 2 /nobreak > nul
)

set FOUND_PID=
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3002 " 2^>nul') do set FOUND_PID=%%a
if not "%FOUND_PID%"=="" (
    echo       WARNING: process %FOUND_PID% is still on port 3002 after 3 attempts.
    echo       Continuing anyway -- if startup fails below with a "socket
    echo       address" error, close any other CFO Server windows manually
    echo       and run this script again.
) else (
    echo       Port 3002 is free.
)
echo.

:: ---- Step 2: quick reachability check for Supabase ----
:: This does NOT replace your actual SUPABASE_URL/.env setup -- it's
:: just a fast sanity check so a real network/DNS problem (which has
:: happened at least once on this project as a one-off blip) shows a
:: clear message HERE, before cfo_server.py starts, rather than
:: surfacing later as a confusing 500/503 error mid-conversation in
:: the chat widget. ping with -n 1 sends exactly one packet so this
:: adds at most ~1 second to startup.
echo  [2/3] Checking network reachability to Supabase...
ping -n 1 -w 1500 qmmanlhtbgxekzbtlgsn.supabase.co >nul 2>&1
if errorlevel 1 (
    echo       WARNING: could not reach qmmanlhtbgxekzbtlgsn.supabase.co
    echo       right now. This may be a temporary network blip -- the
    echo       server will still start, but chat requests may fail with
    echo       a "could not reach Supabase" error until connectivity
    echo       returns. If this persists, check your internet/VPN connection.
) else (
    echo       Supabase is reachable.
)
echo.

:: ---- Step 3: start the server ----
set VENV_PYTHON=F:\Visual Code Directory\RAG-Anything\venv\Scripts\python.exe

echo  [3/3] Starting cfo_server.py on port 3002...
echo.
echo  ------------------------------------------------------------
echo.

:: cd /d switches drive + directory in one step. Must run from
:: APNJ-LLM-Studio (not cfo_tower itself) because cfo_server.py is
:: launched as a MODULE (python -m cfo_tower.cfo_server) -- this is
:: required for its "from cfo_tower.chat.chat_routes import ..."
:: absolute imports to resolve correctly.
cd /d "F:\Visual Code Directory\APNJ-LLM-Studio"
"%VENV_PYTHON%" -m cfo_tower.cfo_server

:: If cfo_server.py exits (crash, Ctrl+C, or the bind error above),
:: keep the window open so you can read the error instead of it
:: vanishing instantly.
echo.
echo  ------------------------------------------------------------
echo  cfo_server.py has stopped. Press any key to close this window.
pause > nul

:: ============================================================
:: ALTERNATIVE: to run this minimized in the background instead
:: (matching your other 5 servers), replace the "cd /d ..." and
:: python launch lines above with:
::
::   start /min "APNJ - CFO Server (DO NOT CLOSE)" cmd /k "cd /d F:\Visual Code Directory\APNJ-LLM-Studio && "%VENV_PYTHON%" -m cfo_tower.cfo_server"
::
:: and remove the "pause" line, since a minimized window has no one
:: watching it to press a key.
:: ============================================================