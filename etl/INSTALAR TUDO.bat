@echo off
rem ===========================================================================
rem  Instala o sistema MOVIMENTACAO DE INVENTARIO na maquina e cria a tarefa
rem  agendada "Inventario - Sync".
rem
rem  Rode NA VM SRV-IA, de duplo clique. Ele pede administrador no meio do
rem  caminho - isso e esperado, e para criar a tarefa no Agendador.
rem
rem  Rode de novo toda vez que mudar alguma coisa nesta pasta de rede: a maquina
rem  nao se atualiza sozinha (ou use o ATUALIZAR AGORA.bat, que so copia e carrega).
rem ===========================================================================
setlocal
cd /d "%~dp0"

echo.
echo   MOVIMENTACAO DE INVENTARIO - instalacao
echo   =======================================
echo.
echo   Antes de continuar, confira se o ENV da pasta "1 - CONFIGURACAO" esta
echo   preenchido. E dele que saem as senhas do Oracle e do Supabase.
echo.
pause

powershell -ExecutionPolicy Bypass -File "3 - INSTALACAO\instalar_e_agendar.ps1"
