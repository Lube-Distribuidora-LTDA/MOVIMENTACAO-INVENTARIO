@echo off
setlocal
title Inventario - carga so as 07:05 (levar para a rede)
rem ===========================================================================
rem  Leva para P:\INTEGRACAO BI\INVENTARIO o horario novo da carga antiga: so as
rem  07:05 (decisao do Julio, 2026-10-26). Troca SO a linha dos horarios do
rem  instalador da rede, com copia de seguranca ao lado.
rem
rem  Rode na SUA maquina (onde o P: existe). Depois, NA VM SRV-IA, de duplo clique
rem  no INSTALAR TUDO.bat do INVENTARIO.
rem  Tudo o que aparece na tela fica tambem em
rem  "LEVAR HORARIO PARA A REDE - registro.txt" (o Claude le de la).
rem ===========================================================================
set "LOG=%~dp0LEVAR HORARIO PARA A REDE - registro.txt"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0levar_horario_para_a_rede.ps1" > "%LOG%" 2>&1
type "%LOG%"
echo.
pause
