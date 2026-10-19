@echo off
rem Abre o painel MOVIMENTACAO DE INVENTARIO nesta maquina (http://localhost:3102),
rem lendo o DATA WAREHOUSE com o ENV de etl (ou C:\BI\INVENTARIO\ENV). So esta maquina acessa.
cd /d "%~dp0web"
if not exist node_modules call npm install --no-audit --no-fund
start "" http://localhost:3102
node servidor_local.js
pause
