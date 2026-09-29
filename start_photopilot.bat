@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Python virtual environment not found.
  echo Run: py -m venv .venv
  echo Then install requirements.txt
  pause
  exit /b 1
)

if not exist "frontend\node_modules" (
  echo Frontend dependencies not found.
  echo Run: cd frontend ^&^& npm install
  pause
  exit /b 1
)

start "PhotoPilot Backend" cmd /k ""%~dp0.venv\Scripts\python.exe" -m uvicorn backend.main:app --reload"
start "PhotoPilot Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

timeout /t 3 /nobreak >nul
start "" "http://localhost:5173"
endlocal
