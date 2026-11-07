# Prova da atualização automática de verdade: instala o WatchMov da release ANTERIOR (o .exe que está no PC dele) e
# confere que ele acha a versão nova, baixa e se atualiza sozinho. Roda no job windows do build-apk.yml, dentro de
# desktop/, DEPOIS que o .exe e o latest.yml da versão nova foram pra release (é deles que a anterior baixa).
param(
  [Parameter(Mandatory)] [string] $Tag,      # release nova, ex.: v5.21
  [Parameter(Mandatory)] [string] $Versao    # versão do app nova, ex.: 5.21.0
)
$ErrorActionPreference = 'Stop'
$repo = $env:GITHUB_REPOSITORY

# Release anterior que já tem o instalador do Windows (a 1ª, v5.20, não tem anterior: nada pra provar).
$anterior = $null
foreach ($t in (gh release list --repo $repo --limit 10 --json tagName --jq '.[].tagName')) {
  if ($t -eq $Tag) { continue }
  $nomes = gh release view $t --repo $repo --json assets --jq '.assets[].name'
  if ($nomes -match '^WatchMov-Setup-.*\.exe$') { $anterior = $t; break }
}
if (-not $anterior) { Write-Output 'nenhuma release anterior com o instalador do Windows: nada pra atualizar'; exit 0 }

New-Item -ItemType Directory -Force anterior | Out-Null
gh release download $anterior --repo $repo -p 'WatchMov-Setup-*.exe' -D anterior --clobber
$setup = Get-ChildItem anterior\WatchMov-Setup-*.exe | Select-Object -First 1
Write-Output "instalando a anterior: $($setup.Name) ($anterior)"
Get-Process WatchMov -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
$p = Start-Process -FilePath $setup.FullName -ArgumentList '/S' -Wait -PassThru
Write-Output "instalador saiu com $($p.ExitCode)"
$exe = Join-Path $env:LOCALAPPDATA 'Programs\watchmov-desktop\WatchMov.exe'
# Versão do .exe no formato do app (o electron-builder grava 5.21.0 ou 5.21.0.0 conforme o campo).
function VersaoDe($caminho) {
  try {
    $vi = (Get-Item $caminho -ErrorAction Stop).VersionInfo
    $v = if ($vi.ProductVersion) { "$($vi.ProductVersion)" } else { "$($vi.FileVersion)" }
    return ($v.Trim() -replace '^(\d+\.\d+\.\d+)\.\d+$', '$1')
  } catch { return '' }
}
$antes = VersaoDe $exe
Write-Output "app instalado: $exe (versão $antes)"
if ($antes -eq $Versao) { throw "a anterior instalou como ${antes}: não dá pra provar a atualização" }
Get-Process WatchMov -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

node atualizacao.mjs --exe $exe --espera $Versao
if ($LASTEXITCODE -ne 0) { throw "a $antes não se atualizou pra $Versao ($LASTEXITCODE)" }

# O instalador da nova roda em silêncio depois que o app fecha: espera ele trocar o WatchMov.exe.
$depois = ''
for ($i = 0; $i -lt 90 -and $depois -ne $Versao; $i++) { Start-Sleep -Seconds 2; $depois = VersaoDe $exe }
if ($depois -ne $Versao) { throw "depois da atualização o app ficou na versão '$depois' (esperada $Versao)" }
Write-Output "✅ atualização automática: $antes → $depois"
Get-Process WatchMov -ErrorAction SilentlyContinue | Stop-Process -Force
