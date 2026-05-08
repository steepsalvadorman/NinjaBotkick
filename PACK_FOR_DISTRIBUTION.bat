@echo off
title CuloconKKRix - Preparar para Distribucion
echo ===================================================
echo    CuloconKKRix - Empaquetando para envio
echo ===================================================

set DIST_DIR=CuloconKKRix_Dist
if exist %DIST_DIR% rd /s /q %DIST_DIR%
mkdir %DIST_DIR%

echo [INFO] Copiando archivos necesarios...
copy culoconkkrix.js %DIST_DIR%\ >nul
copy login.js %DIST_DIR%\ >nul
copy package.json %DIST_DIR%\ >nul
copy package-lock.json %DIST_DIR%\ >nul
copy .env.example %DIST_DIR%\ >nul
copy RUN_BOT.bat %DIST_DIR%\ >nul
xcopy /s /e /i public %DIST_DIR%\public >nul

echo [INFO] Creando archivo ZIP...
powershell -Command "Compress-Archive -Path %DIST_DIR% -DestinationPath %DIST_DIR%.zip -Force"

echo [OK] !Listo! Se ha creado el archivo: %DIST_DIR%.zip
echo Envia este archivo ZIP a la otra PC. 
echo Recuerda que la otra PC necesita tener instalado Node.js.
echo ---------------------------------------------------
pause
