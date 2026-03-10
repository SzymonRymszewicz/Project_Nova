@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

set "PY_CMD="
set "PY_GUI_CMD="
where py >nul 2>nul
if %errorlevel%==0 (
	set "PY_CMD=py -3"
	where pyw >nul 2>nul
	if %errorlevel%==0 (
		set "PY_GUI_CMD=pyw -3"
	)
) else (
	where python >nul 2>nul
	if %errorlevel%==0 (
		set "PY_CMD=python"
		where pythonw >nul 2>nul
		if %errorlevel%==0 (
			set "PY_GUI_CMD=pythonw"
		)
	)
)

if not defined PY_CMD (
	echo [start.bat] Python was not found in PATH.
	echo [start.bat] Install Python 3 and try again.
	exit /b 1
)

echo [start.bat] Using interpreter: %PY_CMD%
%PY_CMD% --version
if errorlevel 1 (
	echo [start.bat] Failed to run Python.
	exit /b 1
)

if defined PY_GUI_CMD (
	echo [start.bat] Launching application without system console...
	start "" %PY_GUI_CMD% "Code\main.py"
	endlocal & exit /b 0
)

echo [start.bat] pythonw/pyw not found. Falling back to console launch.
echo [start.bat] Launching application...
%PY_CMD% "Code\main.py"
set "APP_EXIT=%errorlevel%"

if not "%APP_EXIT%"=="0" (
	echo [start.bat] Application exited with code %APP_EXIT%.
)

endlocal & exit /b %APP_EXIT%
