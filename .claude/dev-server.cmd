@echo off
REM Wrapper local para levantar el bot en dev desde el Browser pane: el PATH
REM del sistema en esta máquina tiene un symlink roto en
REM "C:\Program Files\nodejs" (nvm4w) que no resuelve a node.exe, así que los
REM shims .cmd que generan los paquetes (tsx, etc.) no encuentran "node" al
REM spawnear procesos hijos. Se antepone la carpeta real de nvm4w al PATH
REM SOLO para este proceso, sin tocar el PATH del sistema.
set "PATH=C:\nvm4w\nodejs;%PATH%"
"C:\nvm4w\nodejs\npm.cmd" --prefix "%~dp0..\apps\bot" run dev
