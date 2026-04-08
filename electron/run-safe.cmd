@echo off
REM Launch Chess Analysis with conservative defaults to avoid pegging CPUs/GPUs.
set ENGINE_THREADS=1
set ENGINE_HASH_MB=64
set ELECTRON_DISABLE_GPU_MULTIPROCESS=1
start "" "%~dp0chessanalysis.exe"
