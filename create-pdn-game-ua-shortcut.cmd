@echo off
setlocal

set "PDN_BASE=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$base = $env:PDN_BASE;" ^
  "$candidates = @();" ^
  "$candidates += Get-ChildItem -LiteralPath $base -Filter 'PDN Game UA*.exe' -File -ErrorAction SilentlyContinue;" ^
  "$dist = Join-Path $base 'dist';" ^
  "if (Test-Path -LiteralPath $dist) { $candidates += Get-ChildItem -LiteralPath $dist -Filter 'PDN Game UA*.exe' -File -ErrorAction SilentlyContinue }" ^
  "$exe = $candidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1;" ^
  "if (-not $exe) { Write-Host 'PDN Game UA exe was not found next to this script or in dist.'; exit 1 }" ^
  "$desktop = [Environment]::GetFolderPath('DesktopDirectory');" ^
  "$shortcutPath = Join-Path $desktop 'PDN Game UA.lnk';" ^
  "$shell = New-Object -ComObject WScript.Shell;" ^
  "$shortcut = $shell.CreateShortcut($shortcutPath);" ^
  "$shortcut.TargetPath = $exe.FullName;" ^
  "$shortcut.WorkingDirectory = $exe.DirectoryName;" ^
  "$shortcut.IconLocation = $exe.FullName + ',0';" ^
  "$shortcut.Description = 'PDN Game UA community launcher';" ^
  "$shortcut.Save();" ^
  "Write-Host ('Shortcut created: ' + $shortcutPath);"

if errorlevel 1 (
  pause
  exit /b 1
)

echo Done.
pause
