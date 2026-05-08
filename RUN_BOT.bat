@echo off
title CuloconKKRix - Kick Bot & Overlay
echo ===================================================
echo    CuloconKKRix - Cargando Sistema de Overlay
echo ===================================================

:: Verificar si Node.js esta instalado
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no esta instalado. Por favor instalalo desde: https://nodejs.org/
    pause
    exit
)

:: Verificar si Python esta instalado
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python no esta instalado. Por favor instalalo desde: https://python.org/
    pause
    exit
)

:: Verificar dependencias Node
if not exist node_modules (
    echo [INFO] Instalando dependencias de Node.js...
    call npm install
)

:: Verificar dependencias Python
pip show edge-tts >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Instalando dependencias de Python...
    pip install edge-tts fastapi uvicorn
)

:: Verificar archivo .env y Cookies
if not exist .env (
    echo [INFO] Creando archivo de configuracion inicial...
    copy .env.example .env >nul
)

:: Buscar si hay cookies configuradas
findstr /C:"COOKIES=\"\"" .env >nul
if %errorlevel% equ 0 (
    echo [INFO] No se detectaron credenciales. Iniciando Login Automatico...
    echo [!] Se abrira una ventana de navegador. Inicia sesion en tu cuenta de Kick.
    call npm run login
)

:: Iniciar Servidor de Voz (Python) en segundo plano
echo [OK] Iniciando Servidor de Voz Pro (Edge TTS)...
start /B python tts_server.py

:: Esperar a que el servidor de Python arranque
timeout /t 3 /nobreak >nul

:: Iniciar el bot
echo [OK] Iniciando CuloconKKRix Bot...
echo.
echo   Overlays disponibles:
echo     Glass:  http://localhost:3000/glass.html
echo     Pixel:  http://localhost:3000/pixel.html
echo.
echo   API de Voz: http://127.0.0.1:5000/docs
echo ---------------------------------------------------
node --watch culoconkkrix.js
pause
