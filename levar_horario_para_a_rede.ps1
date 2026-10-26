# levar_horario_para_a_rede.ps1 - chamado pelo "LEVAR HORARIO PARA A REDE.bat".
#
# Leva para P:\INTEGRACAO BI\INVENTARIO o horario novo da carga antiga: so as 07:05
# (decisao do Julio, 2026-10-26). Troca SO a linha $horarios do instalador da rede
# (3 - INSTALACAO\instalar_e_agendar.ps1), com uma copia de seguranca ao lado; o resto
# do arquivo da rede fica exatamente como esta. Rode na SUA maquina (onde o P: existe).
# Depois, NA VM SRV-IA: INSTALAR TUDO.bat do INVENTARIO, que recria a tarefa com o
# horario novo.

param([string]$PastaTeste)   # so para teste: outra pasta no lugar do P:\INTEGRACAO BI

$ErrorActionPreference = "Stop"
$NOVA = '    $horarios = @("07:05")   # so as 07:05 desde 2026-10-26 (Julio): de dia, o AGENTE LUBE mantem o painel ao vivo'

try {
    Write-Output ("Inventario - carga so as 07:05 - " + (Get-Date -Format "dd/MM/yyyy HH:mm:ss") + " - " + $env:USERNAME + " na " + $env:COMPUTERNAME)
    Write-Output ""
    $null = Get-ChildItem "P:\" -ErrorAction SilentlyContinue | Select-Object -First 1   # acorda a unidade de rede
    if ($PastaTeste) { $base = Get-Item -LiteralPath $PastaTeste }
    else { $base = Get-ChildItem "P:\" -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "INTEGRA*BI" } | Select-Object -First 1 }
    if (-not $base) {
        $base = Get-ChildItem "\\192.168.0.5\winthor-adm" -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "INTEGRA*BI" } | Select-Object -First 1
    }
    if (-not $base) { throw "Nao achei a pasta INTEGRACAO BI nem no P: nem em \\192.168.0.5\winthor-adm. Nada foi mudado." }

    $alvo = Join-Path $base.FullName "INVENTARIO\3 - INSTALACAO\instalar_e_agendar.ps1"
    if (-not (Test-Path -LiteralPath $alvo)) { throw ("Nao achei " + $alvo + ". Nada foi mudado.") }

    # le do jeito que o arquivo esta gravado (ASCII, ou UTF-8 com ou sem BOM) e grava igual
    $bytes = [IO.File]::ReadAllBytes($alvo)
    $bom = ($bytes.Length -ge 3) -and ($bytes[0] -eq 0xEF) -and ($bytes[1] -eq 0xBB) -and ($bytes[2] -eq 0xBF)
    $naoAscii = @($bytes | Where-Object { $_ -gt 127 }).Count
    if ($bom -or $naoAscii) { $enc = New-Object System.Text.UTF8Encoding($bom) } else { $enc = [System.Text.Encoding]::ASCII }
    $texto = $enc.GetString($bytes)
    if ($bom -and $texto.Length -gt 0 -and $texto[0] -eq [char]0xFEFF) { $texto = $texto.Substring(1) }
    if ($texto.Contains("`r`n")) { $nl = "`r`n" } else { $nl = "`n" }
    $linhas = $texto -split [regex]::Escape($nl)

    $achadas = @()
    for ($i = 0; $i -lt $linhas.Count; $i++) { if ($linhas[$i] -match '^\s*\$horarios\s*=\s*@\(') { $achadas += $i } }
    if ($achadas.Count -ne 1) { throw ("Esperava 1 linha `$horarios no instalador da rede e achei " + $achadas.Count + ". Nada foi mudado.") }
    $i = $achadas[0]
    $antes = $linhas[$i]

    Write-Output ("Instalador da rede: " + $alvo)
    if (($antes -match '"07:05"') -and ($antes -notmatch '09:05|22:05')) {
        Write-Output "  ja estava so as 07:05: nada a mudar."
    } else {
        $copia = $alvo + ".antes-so-7h-" + (Get-Date -Format "yyyyMMdd-HHmmss")
        Copy-Item -LiteralPath $alvo -Destination $copia
        $linhas[$i] = $NOVA
        [IO.File]::WriteAllText($alvo, ($linhas -join $nl), $enc)
        Write-Output ("  antes : " + $antes.Trim())
        Write-Output ("  agora : " + $NOVA.Trim())
        Write-Output ("  copia de seguranca : " + $copia)
    }

    # confere lendo de novo
    $conf = [IO.File]::ReadAllText($alvo, $enc)
    $ok = @(($conf -split [regex]::Escape($nl)) | Where-Object { $_ -match '^\s*\$horarios\s*=\s*@\("07:05"\)' }).Count -eq 1
    if (-not $ok) { throw "Conferi o arquivo depois de gravar e a linha nova nao esta la. Avise o Claude." }
    Write-Output "  [OK] conferido: o instalador da rede agenda so as 07:05"
    Write-Output ""
    Write-Output "Pronto. Agora, NA VM SRV-IA: abra a pasta INVENTARIO dentro de INTEGRACAO BI"
    Write-Output "e de duplo clique em ""INSTALAR TUDO.bat"". Ele recria a tarefa ""Inventario - Sync"""
    Write-Output "so com as 07:05 (pede administrador e a sua senha do Windows, como da outra vez)."
    exit 0
} catch {
    Write-Output ("[X] " + $_.Exception.Message + " (linha " + $_.InvocationInfo.ScriptLineNumber + ")")
    exit 1
}
