$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Start-Process powershell -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'))
  exit
}
$cfgDir = 'C:\Program Files\EqualizerAPO\config'
$cfg = Join-Path $cfgDir 'config.txt'
if (-not (Test-Path $cfgDir)) {
  Write-Host 'Equalizer APO is not installed. See README.md first.' -ForegroundColor Yellow
  Read-Host 'Press Enter to close'; exit
}
function Get-Pre { $m = Select-String -Path $cfg -Pattern '^Preamp:\s*(-?[\d.]+)\s*dB' | Select-Object -First 1; if ($m) { [double]$m.Matches[0].Groups[1].Value } else { $null } }
function Set-Pre([double]$v) {
  $lines = @(Get-Content $cfg)
  $new = "Preamp: $v dB"; $done = $false
  for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^Preamp:') { $lines[$i] = $new; $done = $true; break } }
  if (-not $done) { $lines = @($new) + $lines }
  Set-Content -Path $cfg -Value $lines -Encoding ASCII
}
$files = @(Get-ChildItem (Join-Path $PSScriptRoot 'presets') -Filter *.txt | Sort-Object Name)
$msg = ''
while ($true) {
  Clear-Host
  Write-Host '=== System EQ presets ===' -ForegroundColor Cyan
  for ($i = 0; $i -lt $files.Count; $i++) { Write-Host ("  {0}) {1}" -f ($i + 1), $files[$i].BaseName) }
  $pre = Get-Pre
  Write-Host ''
  Write-Host ("  Current Preamp: {0} dB" -f $(if ($null -eq $pre) { '(none)' } else { $pre })) -ForegroundColor Yellow
  Write-Host '  +) louder (Preamp +1 dB)    -) quieter (Preamp -1 dB)    q) quit'
  Write-Host '  (louder = bigger effect, but if it crackles/distorts, press - )'
  if ($msg) { Write-Host $msg -ForegroundColor Green }
  $c = Read-Host 'Choose number or +/-'
  if ($c -eq 'q') { break }
  if ($c -eq '+') { $p = Get-Pre; if ($null -eq $p) { $p = 0 }; Set-Pre ($p + 1); $msg = 'Preamp up'; continue }
  if ($c -eq '-') { $p = Get-Pre; if ($null -eq $p) { $p = 0 }; Set-Pre ($p - 1); $msg = 'Preamp down'; continue }
  $n = 0
  if ([int]::TryParse($c, [ref]$n) -and $n -ge 1 -and $n -le $files.Count) {
    Copy-Item $files[$n - 1].FullName $cfg -Force
    $msg = "Applied: " + $files[$n - 1].BaseName
  }
}
