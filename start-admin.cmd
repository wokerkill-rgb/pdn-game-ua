@echo off
setlocal
chcp 65001 >nul
set "PDN_START_ROOT=%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$root=$env:PDN_START_ROOT;" ^
  "$searchRoots=@($root,(Join-Path $root 'dist')) | Where-Object { Test-Path -LiteralPath $_ };" ^
  "$app=(Get-ChildItem -LiteralPath $searchRoots -Filter 'PDN Game UA *.exe' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName;" ^
  "if(-not $app){throw 'PDN Game UA exe was not found near start-admin.cmd or in dist folder';}" ^
  "function Read-SecretText([string]$label){$secure=Read-Host $label -AsSecureString; $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try{[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)} finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}};" ^
  "function Set-RconPassword([string]$serverId,[string]$label,[bool]$required){$password=Read-SecretText $label; if([string]::IsNullOrWhiteSpace($password)){if($required){throw ($label + ' is empty')}; return}; $envName='PDN_RCON_PASSWORD_' + $serverId; $commandName='PDN_RCON_RESTART_COMMAND_' + $serverId; [Environment]::SetEnvironmentVariable($envName,$password,'Process'); if([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($commandName,'Process'))){[Environment]::SetEnvironmentVariable($commandName,'restart','Process')}};" ^
  "$adminName=Read-Host 'Admin login [admin]'; if([string]::IsNullOrWhiteSpace($adminName)){$adminName='admin'};" ^
  "$adminPassword=Read-SecretText 'PDN admin password'; if([string]::IsNullOrWhiteSpace($adminPassword)){throw 'PDN admin password is empty';}" ^
  "$bytes=[Text.Encoding]::UTF8.GetBytes($adminPassword); $hash=[Security.Cryptography.SHA256]::Create().ComputeHash($bytes); $env:PDN_ADMIN_PASSWORD_SHA256=(-join ($hash | ForEach-Object { $_.ToString('x2') }));" ^
  "$env:PDN_ADMIN_USERS=$adminName;" ^
  "Set-RconPassword 'ARMA_REFORGER_PVE_1' 'RCON password server-1' $true;" ^
  "Set-RconPassword 'ARMA_REFORGER_PVE_2' 'RCON password server-2 (optional, press Enter to skip)' $false;" ^
  "Set-RconPassword 'ARMA_REFORGER_PVE_3' 'RCON password server-3 (optional, press Enter to skip)' $false;" ^
  "Write-Host ''; Write-Host 'Starting PDN Game UA admin backend session...' -ForegroundColor Cyan; & $app"

if errorlevel 1 (
  echo.
  echo Admin mode start failed.
  pause
)
