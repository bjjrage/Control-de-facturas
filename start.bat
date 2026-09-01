@echo off
setlocal
cd /d "%~dp0"

echo === Control de Facturas: levantando frontend ===
echo (Backend: Supabase en la nube - proyecto "Control facturas")
echo.

if not exist ".env.local" (
    echo ERROR: no se encontro .env.local. Copia .env.example y completa las claves de Supabase.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Instalando dependencias por primera vez...
    call npm install
    if errorlevel 1 (
        echo.
        echo ERROR: fallo npm install.
        pause
        exit /b 1
    )
)

echo.
echo === Levantando el frontend (Next.js) ===
start "Control de Facturas - Frontend" cmd /k "cd /d "%~dp0" && npm run dev"

echo.
echo App:            http://localhost:3000
echo Supabase (cloud): https://supabase.com/dashboard/project/ljzufgdctghrxiczeyor
echo.
timeout /t 3 >nul
start "" "http://localhost:3000"

endlocal
