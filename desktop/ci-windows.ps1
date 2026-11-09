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
# Player do app (PlayerDesktop.tsx, W3): uma série abre sozinha e passa pela barra, teclado, Ajustes, Links, Episódios,
# Pular abertura, Assistido + contagem, Próximo e Esc. Depende de fonte de terceiro: na release só avisa. Na PR barra.
node smoke.mjs --exe $app --saida smoke-prints --cenario player
if ($LASTEXITCODE -ne 0) {
  if ($env:WM_REDE_SO_AVISA -eq '1') { Write-Output "::warning::smoke do player falhou ($LASTEXITCODE): fonte de terceiro fora do ar; a release segue" }
  else { throw "smoke do player falhou ($LASTEXITCODE)" }
}
# Downloads (downloads.ts, W4): mp4 e HLS de teste (W3C e Mux), fechar o app no meio e continuar, juntar com o ffmpeg
# do app, tocar do disco e sem internet, excluir. Os vídeos são de terceiros: na release só avisa. Na PR barra.
node smoke.mjs --exe $app --saida smoke-prints --cenario downloads
if ($LASTEXITCODE -ne 0) {
  if ($env:WM_REDE_SO_AVISA -eq '1') { Write-Output "::warning::smoke dos downloads falhou ($LASTEXITCODE): vídeo de teste de terceiro fora do ar; a release segue" }
  else { throw "smoke dos downloads falhou ($LASTEXITCODE)" }
}
# Mandar pra TV (cast.ts, W5): uma TV DLNA de mentira na rede do runner (SSDP + SOAP): o app acha, manda o HLS pelo proxy
# do PC (uma qualidade, áudio pt, Referer do link) e o baixado do disco, e a barra pausa/avança/para a TV. O baixado vem
# de terceiro (W3C): na release só avisa. Na PR barra.
node smoke.mjs --exe $app --saida smoke-prints --cenario cast
if ($LASTEXITCODE -ne 0) {
  if ($env:WM_REDE_SO_AVISA -eq '1') { Write-Output "::warning::smoke do cast falhou ($LASTEXITCODE): vídeo de teste de terceiro fora do ar; a release segue" }
  else { throw "smoke do cast falhou ($LASTEXITCODE)" }
}
# Acabamento (W6): máquina limpa (o runner instala do zero) com print de cada tela do menu, a janela que cai volta sozinha e
# a queda chega na aba Bugs (Windows), o aviso do sino (teste) vira aviso do Windows + central, e a pasta dos downloads
# troca pela janela de pastas. Na PR barra; na release só avisa (a queda forçada é o passo mais sensível do runner).
node smoke.mjs --exe $app --saida smoke-prints --cenario fim
if ($LASTEXITCODE -ne 0) {
  if ($env:WM_REDE_SO_AVISA -eq '1') { Write-Output "::warning::smoke do fim falhou ($LASTEXITCODE); a release segue" }
  else { throw "smoke do fim falhou ($LASTEXITCODE)" }
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
