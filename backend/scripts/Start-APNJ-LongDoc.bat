@echo off
title APNJ LLM Studio - Long Document Profile
color 0D
echo.
echo  APNJ LLM Studio - Long Document Profile
echo  Yarn-Mistral 7B 128K context
echo  USE FOR: Very long documents, entire books, large reports
echo  NOTE: Uses 7.2GB VRAM - RAG search not available
echo  NOTE: Q8 model - takes 25-35 seconds to load
echo.

REM SERVER 1: Yarn-Mistral - Port 8080 - 128K context
echo  [1/2] Starting Yarn-Mistral on port 8080...
start "APNJ - Yarn-Mistral Long Doc (DO NOT CLOSE)" cmd /k "cd /d F:\llama.cpp-master\llama.cpp-master\build\bin && llama-server.exe -m "F:\LLM Models\Yarn-Mistral-7B-128k-GGUF\yarn-mistral-7b-128k.Q8_0.gguf" -ngl 99 -c 32768 --host 0.0.0.0 --port 8080"

echo  Waiting for Yarn-Mistral to load (25 seconds)...
timeout /t 25 /nobreak > nul

REM SERVER 2: CORS Proxy only - no Nomic (saves VRAM)
echo  [2/2] Starting CORS Proxy on port 3000...
start "APNJ - CORS Proxy (DO NOT CLOSE)" cmd /k "python "F:\Visual Code Directory\APNJ-LLM-Studio\proxy.py""
timeout /t 2 /nobreak > nul

echo  Opening APNJ LLM Studio in browser...
start chrome "http://127.0.0.1:3000"

echo.
echo  LONG DOC PROFILE RUNNING
echo  Yarn-Mistral - port 8080  128K context
echo  CORS Proxy   - port 3000  Studio UI
echo.
echo  RAG and Excel tabs NOT available in this profile
echo  Paste entire documents directly into Chat
echo.
echo  Tips: Paste the full document in chat
echo        Ask to summarise specific sections
echo        128K context fits approx 96000 words
echo.
echo  Keep BOTH windows open!
pause