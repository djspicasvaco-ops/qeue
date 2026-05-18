@echo off
SET DIR=%~dp0
SET APP=%DIR%qeue.html

:: Find Chrome
SET CHROME=
FOR %%P IN (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
) DO (
  IF EXIST %%P SET CHROME=%%P
)

IF "%CHROME%"=="" (
  echo Chrome not found. Please install Google Chrome.
  pause
  exit /b 1
)

start "" %CHROME% --app="file:///%APP:\=/%"  --window-size=1280,820 --disable-extensions-except --no-first-run --disable-default-apps
