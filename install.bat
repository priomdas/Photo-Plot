@echo off
setlocal
cd /d "%~dp0"

echo ==============================================
echo Installing PhotoPilot Dependencies...
echo ==============================================

echo.
echo [1/2] Setting up Python backend...
if not exist ".venv\Scripts\python.exe" (
    echo Creating virtual environment...
    python -m venv .venv
)

echo Installing backend requirements...
call .venv\Scripts\activate.bat
pip install -r requirements.txt
call deactivate

echo.
echo [2/2] Setting up React frontend...
cd frontend
if not exist "node_modules" (
    echo Installing node modules...
    call npm install
)
cd ..

echo.
echo ==============================================
echo Setup Complete!
echo You can now run the project using: start_photopilot.bat
echo ==============================================
pause
endlocal
