@echo off
title APNJ LLM Studio - Main Profile
color 0A
echo.
echo  APNJ LLM Studio - Main Profile
echo  Gemma Chat + Nomic Embed + RAG Server + Auto-Indexer + Cloudflare Tunnel
echo  USE FOR: General chat, RAG, Excel, Web search
echo.
REM SERVER 1: Gemma Chat - Port 8080
echo  [1/6] Starting Gemma Chat on port 8080...
start "APNJ - Gemma Chat (DO NOT CLOSE)" cmd /k "cd /d F:\llama.cpp-master\llama.cpp-master\build\bin && llama-server.exe -m "F:\LLM Models\gemma-4-E4B-it-GGUF\gemma-4-E4B-it-Q4_K_M.gguf" -ngl 99 -c 4096 --host 0.0.0.0 --port 8080"
echo  Waiting for Gemma to load...
timeout /t 12 /nobreak > nul
REM SERVER 2: Nomic Embed - Port 8081
echo  [2/6] Starting Nomic Embed on port 8081...
start "APNJ - Nomic Embed (DO NOT CLOSE)" cmd /k "cd /d F:\llama.cpp-master\llama.cpp-master\build\bin && llama-server.exe -m "F:\LLM Models\Nomic-Embed-Text-V2-GGUF\nomic-embed-text-v2-moe-q8_0.gguf" -ngl 99 -c 2048 --host 0.0.0.0 --port 8081 --embeddings --pooling mean"
echo  Waiting for Nomic to load...
timeout /t 8 /nobreak > nul
REM SERVER 3: RAG Server - Port 3001
echo  [3/6] Starting RAG Server on port 3001...
start "APNJ - RAG Server (DO NOT CLOSE)" cmd /k "python "F:\Visual Code Directory\APNJ-LLM-Studio\rag\rag_server.py""
timeout /t 3 /nobreak > nul
REM SERVER 4: Auto-Indexer - watches all data folders
echo  [4/6] Starting Auto-Indexer...
start "APNJ - Auto Indexer (DO NOT CLOSE)" cmd /k "python "F:\Visual Code Directory\APNJ-LLM-Studio\rag\auto_indexer.py""
timeout /t 3 /nobreak > nul
REM SERVER 5: CORS Proxy - Port 3000
echo  [5/6] Starting CORS Proxy on port 3000...
start "APNJ - CORS Proxy (DO NOT CLOSE)" cmd /k "python "F:\Visual Code Directory\APNJ-LLM-Studio\proxy.py""
timeout /t 2 /nobreak > nul
REM SERVER 6: Cloudflare Tunnel - exposes port 3000 to Vercel app
echo  [6/6] Starting Cloudflare Tunnel...
start "APNJ - Cloudflare Tunnel (DO NOT CLOSE)" cmd /k "cloudflared tunnel --url http://127.0.0.1:3000"
echo  Waiting for tunnel to connect...
timeout /t 8 /nobreak > nul
echo  Opening APNJ LLM Studio in browser...
start chrome "http://127.0.0.1:3000"
echo.
echo  ALL 6 SERVERS RUNNING
echo  Gemma Chat        - port 8080  chat and vision
echo  Nomic Embed       - port 8081  RAG and search
echo  RAG Server        - port 3001  Q and A engine
echo  Auto Indexer      - watches   uploaded_docs and uploaded_excels
echo  CORS Proxy        - port 3000  Studio UI
echo  Cloudflare Tunnel - public HTTPS URL for Vercel app
echo.
echo  IMPORTANT: Check the "APNJ - Cloudflare Tunnel" window for your URL.
echo  It will look like: https://xxxx-xxxx-xxxx.trycloudflare.com
echo  Copy that URL and update VITE_LLM_TUNNEL_URL in Vercel env vars.
echo.
echo  Drop any PDF DOCX TXT XLSX CSV into their data folders
echo  Auto-Indexer will embed and index instantly!
echo.
echo  Keep all SIX windows open!
echo  You can close THIS window safely.
echo.
pause