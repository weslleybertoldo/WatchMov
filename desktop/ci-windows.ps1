# Instala o WatchMov gerado pelo electron-builder (silencioso, por usuário) e roda o smoke no app INSTALADO.
# Usado pelos workflows build-apk.yml (job windows) e desktop-pr.yml, dentro de desktop/.
$ErrorActionPreference = 'Stop'
$setup = Get-ChildItem release\WatchMov-Setup-*.exe | Select-Object -First 1
if (-not $setup) { throw 'não achei o instalador em desktop\release' }
$p = Start-Process -FilePath $setup.FullName -ArgumentList '/S' -Wait -PassThru
Write-Output "instalador $($setup.Name) saiu com $($p.ExitCode)"
$app = $null
for ($i = 0; $i -lt 30 -and -not $app; $i++) {
  $app = Get-ChildItem "$env:LOCALAPPDATA\Programs" -Filter WatchMov.exe -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $app) { Start-Sleep -Seconds 2 }
}
if (-not $app) {
  Get-ChildItem "$env:LOCALAPPDATA\Programs" -ErrorAction SilentlyContinue | ForEach-Object { Write-Output " - $($_.Name)" }
  throw 'o instalador não pôs o WatchMov.exe em LOCALAPPDATA\Programs'
}
Write-Output "app instalado: $app"
reg query "HKCU\Software\Classes\com.weslley.watchmov" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'o endereço de volta do login (com.weslley.watchmov) não foi registrado no Windows' }
Write-Output 'endereço de volta do login registrado no Windows'
# Se o instalador abriu o app no fim, fecha: o smoke abre o dele (o app só aceita 1 cópia aberta).
Get-Process WatchMov -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
node smoke.mjs --exe $app --saida smoke-prints
if ($LASTEXITCODE -ne 0) { throw "smoke falhou ($LASTEXITCODE)" }
