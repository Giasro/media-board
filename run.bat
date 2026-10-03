@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Gv
where py >nul 2>nul && (py -3 server.py & goto :end)
where python >nul 2>nul && (python server.py & goto :end)
for %%P in ("%LocalAppData%\Programs\Python\Python310\python.exe" "%LocalAppData%\Programs\Python\Python311\python.exe" "%LocalAppData%\Programs\Python\Python312\python.exe" "C:\Python310\python.exe") do if exist %%P (%%P server.py & goto :end)
echo.
echo Python not found. Install Python 3 and check "Add python.exe to PATH".
:end
echo.
echo Server stopped.
pause
