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
# Se o instalador abriu o app no fim, fecha: o smoke abre o dele (o app só aceita 1 cópia aberta).
Get-Process WatchMov -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
node smoke.mjs --exe $app --saida smoke-prints
if ($LASTEXITCODE -ne 0) { throw "smoke falhou ($LASTEXITCODE)" }
# Rede de app (rede.ts): DNS próprio, Ao Vivo, as fontes no iframe e a propaganda bloqueada.
# Na release (WM_REDE_SO_AVISA=1) ele só avisa: depende das fontes e do SuperFlix, que caem sem o app mudar. Na PR barra.
node smoke.mjs --exe $app --saida smoke-prints --cenario rede
if ($LASTEXITCODE -ne 0) {
  if ($env:WM_REDE_SO_AVISA -eq '1') { Write-Output "::warning::smoke da rede falhou ($LASTEXITCODE): fonte ou lista de terceiro fora do ar; a release segue" }
  else { throw "smoke da rede falhou ($LASTEXITCODE)" }
}
# Abrir sozinho (captura.ts, W2): o título abre, a janela escondida acha o vídeo e ele toca no player do app.
# Também depende de fonte de terceiro: na release só avisa (mesma variável do cenário rede). Na PR barra.
node smoke.mjs --exe $app --saida smoke-prints --cenario captura
if ($LASTEXITCODE -ne 0) {
  if ($env:WM_REDE_SO_AVISA -eq '1') { Write-Output "::warning::smoke da captura falhou ($LASTEXITCODE): fonte de terceiro fora do ar; a release segue" }
  else { throw "smoke da captura falhou ($LASTEXITCODE)" }
}
# O app registra o endereço de volta do login no Windows quando abre (main.ts: setAsDefaultProtocolClient).
reg query "HKCU\Software\Classes\com.weslley.watchmov\shell\open\command"
if ($LASTEXITCODE -ne 0) { throw 'o endereço de volta do login (com.weslley.watchmov) não ficou registrado no Windows' }
# E o Windows abre o app pelo link, como na volta do navegador depois do login do Google.
Get-Process WatchMov -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process 'com.weslley.watchmov://login-callback#error=teste_do_ci'
$aberto = $false
for ($i = 0; $i -lt 15 -and -not $aberto; $i++) { Start-Sleep -Seconds 1; $aberto = [bool](Get-Process WatchMov -ErrorAction SilentlyContinue) }
Get-Process WatchMov -ErrorAction SilentlyContinue | Stop-Process -Force
if (-not $aberto) { throw 'o Windows não abriu o app pelo link com.weslley.watchmov://' }
Write-Output 'o Windows abriu o app pelo link de volta do login'
