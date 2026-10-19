@echo off
rem ===========================================================================
rem  DIAGNOSTICO - Movimentacao de Inventario
rem  Roda todas as consultas contra o WinThor SEM GRAVAR NADA, mede o tempo e
rem  confere a 1147 contra o PCMOV, mes a mes. Resultado na tela e em
rem  diagnostico_inventario.log (na pasta "2 - SISTEMA INVENTARIO").
rem ===========================================================================
setlocal
cd /d "%~dp0"
title Movimentacao de Inventario - diagnostico
python "2 - SISTEMA INVENTARIO\diagnostico_inventario.py"
echo.
pause
endlocal
