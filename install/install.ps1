# AskCharts for Windows. Paste into PowerShell:
#   irm https://github.com/realgrapedrop/askcharts/releases/latest/download/install.ps1 | iex
#
# It puts AskCharts in your AskCharts folder (C:\Users\you\AskCharts) with its own copy of Node.js
# (checked against nodejs.org's checksums), starts it now and whenever you log in, and opens it in your
# browser. No admin rights. Run it again to update: your charts and settings stay in AskCharts\data.
# To remove it, double-click uninstall.cmd in that folder.
#
# For testing: ASKCHARTS_BASE (where to download AskCharts from), ASKCHARTS_HOME (instead of
# %USERPROFILE%\AskCharts), ASKCHARTS_NO_OPEN=1 (don't open the browser).
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue' # downloads are far quicker without the progress bar
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  $Base = if ($env:ASKCHARTS_BASE) { $env:ASKCHARTS_BASE } else { 'https://github.com/realgrapedrop/askcharts/releases/latest/download' }
  $Dir = if ($env:ASKCHARTS_HOME) { $env:ASKCHARTS_HOME } else { Join-Path $HOME 'AskCharts' }
  $NodeVersion = '24.21.0'
  $NodeBase = "https://nodejs.org/dist/v$NodeVersion"
  $Data = Join-Path $Dir 'data'
  $Node = Join-Path $Dir 'node\node.exe'

  function Say($m) { Write-Host $m }
  function Fail($m) { Write-Host "AskCharts: $m" -ForegroundColor Red; throw "AskCharts: $m" }

  # A path inside the single quotes of a generated script: a ' in it (O'Brien) is written twice
  function Q($s) { $s -replace "'", "''" }
  $startup = [IO.Path]::Combine([Environment]::GetFolderPath('Startup'), 'AskCharts.lnk')
  $menu = [IO.Path]::Combine([Environment]::GetFolderPath('Programs'), 'AskCharts.lnk')
  # The scripts it leaves in your AskCharts folder
  function Write-Scripts($Dir, $startup, $menu) {
    # start.cmd runs it in a window (handy to see what it says); start-hidden.ps1 is what logging in runs
    Set-Content -Encoding ASCII -Path (Join-Path $Dir 'start.cmd') -Value @"
@echo off
set "ASKCHARTS_DATA=%~dp0data"
"%~dp0node\node.exe" "%~dp0program\run.mjs" %*
"@
    Set-Content -Encoding UTF8 -Path (Join-Path $Dir 'start-hidden.ps1') -Value @"
# Starts AskCharts with no window (its output goes to data\askcharts.log). -Open: then open it.
param([switch]`$Open)
`$dir = '$(Q $Dir)'
`$running = `$false
`$pidFile = Join-Path `$dir 'data\run.pid'
if (Test-Path `$pidFile) { `$running = [bool](Get-Process -Id ([int](Get-Content `$pidFile)) -ErrorAction SilentlyContinue) }
if (-not `$running) {
  Remove-Item (Join-Path `$dir 'data\port') -ErrorAction SilentlyContinue
  # cmd /c drops the first and last quote of what follows, so the whole line gets one more pair
  `$cmd = '""' + (Join-Path `$dir 'start.cmd') + '" >> "' + (Join-Path `$dir 'data\askcharts.log') + '" 2>&1"'
  Start-Process -FilePath `$env:ComSpec -ArgumentList '/c', `$cmd -WindowStyle Hidden
}
if (`$Open) {
  for (`$i = 0; `$i -lt 60; `$i++) {
    `$portFile = Join-Path `$dir 'data\port'
    if (Test-Path `$portFile) {
      `$url = 'http://localhost:' + (Get-Content `$portFile)
      try { Invoke-WebRequest -UseBasicParsing -Uri `$url -TimeoutSec 2 | Out-Null; Start-Process `$url; break } catch { }
    }
    Start-Sleep -Seconds 1
  }
}
"@
    Set-Content -Encoding UTF8 -Path (Join-Path $Dir 'uninstall.ps1') -Value @"
# Removes AskCharts: stops it, takes it out of your logins and the Start menu, deletes the program and
# its Node.js. Your charts and settings stay in data until you delete that folder.
`$dir = '$(Q $Dir)'
`$pidFile = Join-Path `$dir 'data\run.pid'
if (Test-Path `$pidFile) { Stop-Process -Id ([int](Get-Content `$pidFile)) -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }
Remove-Item -Force '$(Q $startup)', '$(Q $menu)' -ErrorAction SilentlyContinue
foreach (`$p in 'program', 'node', 'start.cmd', 'start-hidden.ps1', 'uninstall.cmd') { Remove-Item -Recurse -Force (Join-Path `$dir `$p) -ErrorAction SilentlyContinue }
Write-Host "AskCharts is removed. Your charts and settings are still in `$dir\data: delete that folder to remove them too."
Remove-Item -Force (Join-Path `$dir 'uninstall.ps1') -ErrorAction SilentlyContinue
"@
    Set-Content -Encoding ASCII -Path (Join-Path $Dir 'uninstall.cmd') -Value @"
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
pause
"@
  }
  # for testing: write those scripts into ASKCHARTS_RENDER_TO and stop, so they can be checked anywhere
  if ($env:ASKCHARTS_RENDER_TO) {
    New-Item -ItemType Directory -Force -Path $env:ASKCHARTS_RENDER_TO | Out-Null
    Write-Scripts $env:ASKCHARTS_RENDER_TO $startup $menu
    return
  }

  $arch = switch ($env:PROCESSOR_ARCHITECTURE) { 'AMD64' { 'x64' } 'ARM64' { 'arm64' } default { Fail "this computer's processor ($env:PROCESSOR_ARCHITECTURE) isn't one Node.js $NodeVersion supports here" } }
  if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) { Fail 'this needs tar.exe, which comes with Windows 10 (1803) and later' }

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("askcharts-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    # fetch a file from a base address, then check it against that base's checksum list
    function Fetch($base, $file, $sums) {
      $to = Join-Path $tmp $file
      try { Invoke-WebRequest -UseBasicParsing -Uri "$base/$file" -OutFile $to } catch { Fail "couldn't download $base/$file" }
      $line = Get-Content (Join-Path $tmp $sums) | Where-Object { $_ -match "\s\*?$([regex]::Escape($file))$" } | Select-Object -First 1
      if (-not $line) { Fail "$file isn't in $base/$sums" }
      $want = ($line -split '\s+')[0]
      if ((Get-FileHash -Algorithm SHA256 $to).Hash -ne $want) { Fail "$file didn't match its checksum: not installing it" }
      $to
    }

    Say 'Downloading AskCharts...'
    try { Invoke-WebRequest -UseBasicParsing -Uri "$Base/SHA256SUMS" -OutFile (Join-Path $tmp 'SHA256SUMS') } catch { Fail "couldn't download $Base/SHA256SUMS" }
    $tarball = Fetch $Base 'askcharts.tar.gz' 'SHA256SUMS'
    New-Item -ItemType Directory -Force -Path $Dir, $Data | Out-Null

    $have = if (Test-Path $Node) { (& $Node --version) 2>$null } else { '' }
    if ($have -eq "v$NodeVersion") {
      Say "Node.js $NodeVersion is already here."
    } else {
      Say "Downloading Node.js $NodeVersion (about 35 MB)..."
      try { Invoke-WebRequest -UseBasicParsing -Uri "$NodeBase/SHASUMS256.txt" -OutFile (Join-Path $tmp 'SHASUMS256.txt') } catch { Fail "couldn't reach nodejs.org" }
      $pkg = "node-v$NodeVersion-win-$arch"
      $zip = Fetch $NodeBase "$pkg.zip" 'SHASUMS256.txt'
      Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'node')
      # just the runtime and its licence: AskCharts needs no npm
      Remove-Item -Recurse -Force (Join-Path $Dir 'node') -ErrorAction SilentlyContinue
      New-Item -ItemType Directory -Force -Path (Join-Path $Dir 'node') | Out-Null
      Move-Item (Join-Path $tmp "node\$pkg\node.exe") $Node
      Move-Item (Join-Path $tmp "node\$pkg\LICENSE") (Join-Path $Dir 'node\LICENSE')
    }

    # stop the running one (an update), so its files can be swapped
    $pidFile = Join-Path $Data 'run.pid'
    if (Test-Path $pidFile) {
      $old = Get-Content $pidFile -ErrorAction SilentlyContinue
      if ($old) { Stop-Process -Id ([int]$old) -Force -ErrorAction SilentlyContinue }
      Start-Sleep -Seconds 2
    }
    # a port from the last run would point at the wrong place until the new one writes its own
    Remove-Item (Join-Path $Data 'port') -ErrorAction SilentlyContinue

    Say "Installing into $Dir..."
    $new = Join-Path $tmp 'new'
    New-Item -ItemType Directory -Path $new | Out-Null
    & tar.exe -xzf $tarball -C $new
    if (-not (Test-Path (Join-Path $new 'askcharts\run.mjs'))) { Fail "the download isn't an AskCharts release" }
    $program = Join-Path $Dir 'program'
    Remove-Item -Recurse -Force $program -ErrorAction SilentlyContinue
    Move-Item (Join-Path $new 'askcharts') $program

    Write-Scripts $Dir $startup $menu

    # at every log in, and in the Start menu (which opens it)
    $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shell = New-Object -ComObject WScript.Shell
    $icon = Join-Path $program 'app\public\icons\askcharts.ico'
    function Shortcut($path, $extra) {
      $l = $shell.CreateShortcut($path)
      $l.TargetPath = $ps
      $l.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $Dir 'start-hidden.ps1')`" $extra"
      $l.WorkingDirectory = $Dir
      $l.WindowStyle = 7
      if (Test-Path $icon) { $l.IconLocation = $icon }
      $l.Save()
    }
    Shortcut $startup ''
    Shortcut $menu '-Open'

    Say 'Starting AskCharts...'
    & $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dir 'start-hidden.ps1')
    $url = $null
    for ($i = 0; $i -lt 60; $i++) {
      $portFile = Join-Path $Data 'port'
      if (Test-Path $portFile) {
        $try = 'http://localhost:' + (Get-Content $portFile)
        try { Invoke-WebRequest -UseBasicParsing -Uri $try -TimeoutSec 2 | Out-Null; $url = $try; break } catch { }
      }
      Start-Sleep -Seconds 1
    }
    if (-not $url) { Fail "AskCharts didn't start. What it said is in $Data\askcharts.log" }
    if (-not $env:ASKCHARTS_NO_OPEN) { Start-Process $url }
    Say ''
    Say "AskCharts is running: $url"
    Say 'It starts by itself when you log in. To update, paste the same line again.'
    Say "To remove it: double-click uninstall.cmd in $Dir"
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}
