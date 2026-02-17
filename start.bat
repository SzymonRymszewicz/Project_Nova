@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

echo ==========================================
echo Nova bootstrap: deps ^+ run
echo ==========================================

set "BASE_PY="
for /f "delims=" %%I in ('py -3 -c "import sys; print(sys.executable)" 2^>nul') do set "BASE_PY=%%I"
if not defined BASE_PY (
	for /f "delims=" %%I in ('python -c "import sys; print(sys.executable)" 2^>nul') do set "BASE_PY=%%I"
)
if not defined BASE_PY (
	echo [ERROR] Python 3 was not found. Install Python and try again.
	pause
	exit /b 1
)

echo [INFO] Base Python: %BASE_PY%

set "VENV_DIR=.venv"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"
set "VENV_PYW=%VENV_DIR%\Scripts\pythonw.exe"

if not exist "%VENV_PY%" (
	echo [STEP] Creating local virtual environment...
	"%BASE_PY%" -m venv "%VENV_DIR%"
	if errorlevel 1 (
		echo [ERROR] Failed to create virtual environment.
		pause
		exit /b 1
	)
)

echo [INFO] Runtime Python: %VENV_PY%

echo [STEP] Upgrading pip tools in .venv...
"%VENV_PY%" -m pip install --upgrade pip setuptools wheel
if errorlevel 1 (
	echo [WARN] Failed to upgrade pip tools. Continuing...
)

echo [STEP] Installing LocalModel dependency (llama-cpp-python)...
"%VENV_PY%" -m pip install --upgrade --prefer-binary --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu llama-cpp-python
if errorlevel 1 (
	echo [WARN] Wheel install failed, trying standard pip install...
	"%VENV_PY%" -m pip install --upgrade --prefer-binary llama-cpp-python
	if errorlevel 1 (
		echo [WARN] llama-cpp-python install failed.
		echo [WARN] LocalModel provider may not work until this package is installed.
	)
)

echo [STEP] Launching application and closing this console...
if exist "%VENV_PYW%" (
	start "" "%VENV_PYW%" "Code\main.py"
) else (
	start "" "%VENV_PY%" "Code\main.py"
)

exit /b 0
