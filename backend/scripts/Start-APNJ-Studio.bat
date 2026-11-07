@echo off
:: Create soffice wrapper so RAG-Anything can find LibreOffice
(echo @echo off & echo "C:\Program Files\LibreOffice\program\soffice.exe" %%*) > C:\Windows\soffice.bat
:: Kill any existing processes on all server ports
echo  Cleaning up existing processes...
taskkill /f /im llama-server.exe >nul 2>&1
taskkill /f /im python.exe >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8080 :8081 :3001 :3004 :3000 " 2^>nul') do (
    taskkill /f /pid %%a >nul 2>&1
)
timeout /t 3 /nobreak > nul
:: Python paths — NO quotes in set command
set PYTHON=C:\Users\Neil Joglekar\AppData\Local\Python\pythoncore-3.11-64\python.exe
set VENV_PYTHON=F:\Visual Code Directory\RAG-Anything\venv\Scripts\python.exe

title APNJ LLM Studio - GPU Edition
color 0A
echo.
echo  APNJ LLM Studio - GPU Edition (RTX 5050)
echo  Starting all servers in background...
echo.

REM SERVER 1: Qwen2.5-Coder Chat - Port 8080
echo  [1/7] Starting Qwen2.5-Coder on port 8080 (GPU)...
start /min "APNJ - Qwen2.5-VL Chat (DO NOT CLOSE)" cmd /k "cd /d F:\llama-cpp-cuda\build\bin\Release && llama-server.exe -m "F:\LLM Models\Qwen2.5-VL-7B-Instruct-GGUF\Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf" --mmproj "F:\LLM Models\Qwen2.5-VL-7B-Instruct-GGUF\mmproj-F16.gguf" -ngl 99 -c 32768 -np 1 --host 0.0.0.0 --port 8080 --jinja"
echo  Waiting for Qwen to load...
timeout /t 12 /nobreak > nul

REM SERVER 2: Nomic Embed - Port 8081
echo  [2/7] Starting Nomic Embed on port 8081 (GPU)...
start /min "APNJ - Nomic Embed (DO NOT CLOSE)" cmd /k "cd /d F:\llama-cpp-cuda\build\bin\Release && llama-server.exe -m "F:\LLM Models\Nomic-Embed-Text-V2-GGUF\nomic-embed-text-v2-moe-q8_0.gguf" -ngl 99 -c 2048 -b 2048 --host 0.0.0.0 --port 8081 --embeddings --pooling mean"
echo  Waiting for Nomic to load...
timeout /t 6 /nobreak > nul

REM SERVER 3: RAG Bridge (RAG-Anything) - Port 3001
echo  [3/7] Starting RAG Bridge on port 3001...
start /min "APNJ - RAG Bridge (DO NOT CLOSE)" powershell -ExecutionPolicy Bypass -File "F:\Visual Code Directory\APNJ-LLM-Studio\Start-RAG-Bridge.ps1"
timeout /t 10 /nobreak > nul

REM SERVER 4: Jarvis Backend - Port 3004
echo  [4/7] Starting Jarvis Server on port 3004...
start /min "APNJ - Jarvis Server (DO NOT CLOSE)" cmd /k ""%VENV_PYTHON%" "F:\Visual Code Directory\APNJ-LLM-Studio\rag\jarvis_server.py""
echo  Waiting for Jarvis Server to load...
timeout /t 5 /nobreak > nul

REM SERVER 5: CORS Proxy - Port 3000
echo  [5/7] Starting CORS Proxy on port 3000...
start /min "APNJ - CORS Proxy (DO NOT CLOSE)" cmd /k ""%PYTHON%" "F:\Visual Code Directory\APNJ-LLM-Studio\proxy.py""
timeout /t 2 /nobreak > nul

REM SERVER 6: Jarvis Watcher (background — no port, recursive folder watch)
echo  [6/7] Starting Jarvis Watcher (recursive Excel/code/folder watch)...
start /min "APNJ - Jarvis Watcher (DO NOT CLOSE)" cmd /k ""%VENV_PYTHON%" "F:\Visual Code Directory\APNJ-LLM-Studio\rag\jarvis_watcher.py""
timeout /t 2 /nobreak > nul

REM SERVER 7: Cloudflare Tunnel
echo  [7/7] Starting Cloudflare Tunnel...
start /min "APNJ - Cloudflare Tunnel (DO NOT CLOSE)" cmd /k ""%PYTHON%" "F:\Visual Code Directory\APNJ-LLM-Studio\update_tunnel_url.py""
echo  Waiting for tunnel to connect...
timeout /t 8 /nobreak > nul

echo  Opening APNJ LLM Studio in browser...
start chrome "http://127.0.0.1:3000"

echo.
echo  +--------------------------------------------------+
echo  ^|   ALL 7 SERVERS RUNNING  (RTX 5050 GPU)          ^|
echo  +--------------------------------------------------+
echo  ^|  Qwen Coder    port 8080  GPU accelerated        ^|
echo  ^|  Nomic Embed   port 8081  GPU accelerated        ^|
echo  ^|  RAG Bridge    port 3001  RAG-Anything + MinerU  ^|
echo  ^|  Jarvis Server port 3004  Excel/code graph + RAG ^|
echo  ^|  CORS Proxy    port 3000                         ^|
echo  ^|  Jarvis Watcher   -       recursive auto-index   ^|
echo  ^|  CF Tunnel     check taskbar for URL             ^|
echo  +--------------------------------------------------+
echo.
echo  To get Cloudflare URL: click the minimised
echo  "APNJ - Cloudflare Tunnel" window in your taskbar.
echo  Look for: https://xxxx-xxxx.trycloudflare.com
echo.
echo  Verify GPU: run  nvidia-smi  in another terminal
echo  You should see llama-server using ~3200MB + ~400MB
echo.
pause