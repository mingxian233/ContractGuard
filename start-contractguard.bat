@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

echo [ContractGuard] Checking local runtime...

where node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  echo Install Node.js 22.13 or newer, then open a new terminal.
  goto :failed
)

node.exe -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] ContractGuard requires Node.js 22.13 or newer.
  goto :failed
)

if not exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" (
  echo [ERROR] Windows PowerShell was not found.
  goto :failed
)

if not exist "node_modules\" (
  echo [ERROR] Dependencies are not installed.
  echo Run: pnpm.cmd install --frozen-lockfile
  goto :failed
)

if not exist "apps\api\dist\index.js" (
  echo [ERROR] The API build output is missing.
  echo Run: pnpm.cmd build
  goto :failed
)

if not exist "packages\core\dist\index.js" (
  echo [ERROR] The core build output is missing.
  echo Run: pnpm.cmd build
  goto :failed
)

if not exist "apps\web\dist\index.html" (
  echo [ERROR] The Web build output is missing.
  echo Run: pnpm.cmd build
  goto :failed
)

echo [ContractGuard] Enter the DeepSeek API key when prompted.
echo [ContractGuard] Press Enter without a key to start with AI interpretation disabled.
echo [ContractGuard] A supplied key is used only by this process and is not saved to disk.
echo [ContractGuard] Open http://localhost:8080 after the server is ready.
echo.

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$secureKey = $null; $plainKey = $null; $processExitCode = 1;" ^
  "try {" ^
  "  $secureKey = Read-Host -Prompt 'DeepSeek API Key (optional)' -AsSecureString;" ^
  "  $plainKey = [System.Net.NetworkCredential]::new('', $secureKey).Password;" ^
  "  if ([string]::IsNullOrWhiteSpace($plainKey)) {" ^
  "    $env:CONTRACTGUARD_AI_ENABLED = 'false';" ^
  "    Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue;" ^
  "    Write-Host '[ContractGuard] Starting without the optional AI interpreter.';" ^
  "  } else {" ^
  "    $env:CONTRACTGUARD_AI_ENABLED = 'true';" ^
  "    $env:DEEPSEEK_API_KEY = $plainKey;" ^
  "  };" ^
  "  $env:DEEPSEEK_BASE_URL = 'https://api.deepseek.com';" ^
  "  $env:DEEPSEEK_MODEL = 'deepseek-flash';" ^
  "  $env:CONTRACTGUARD_AI_TIMEOUT_MS = '30000';" ^
  "  $env:CONTRACTGUARD_AI_MAX_CHANGES = '50';" ^
  "  $env:CONTRACTGUARD_AI_MAX_OUTPUT_TOKENS = '8192';" ^
  "  Remove-Variable plainKey -ErrorAction SilentlyContinue;" ^
  "  & node.exe 'apps/api/dist/index.js';" ^
  "  $processExitCode = $LASTEXITCODE;" ^
  "} catch {" ^
  "  Write-Error $_;" ^
  "  $processExitCode = 1;" ^
  "} finally {" ^
  "  Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue;" ^
  "  Remove-Variable plainKey -ErrorAction SilentlyContinue;" ^
  "  if ($null -ne $secureKey) { $secureKey.Dispose() };" ^
  "};" ^
  "exit $processExitCode"

set "contractguardExitCode=%ERRORLEVEL%"
if not "%contractguardExitCode%"=="0" (
  echo.
  echo [ERROR] ContractGuard exited with code %contractguardExitCode%.
  pause
)

endlocal & exit /b %contractguardExitCode%

:failed
echo.
pause
endlocal
exit /b 1
