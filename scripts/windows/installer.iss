; Single-file Windows installer for AIUsageBar (built by scripts/make-win-installer.ts).
;
; Electrobun's Setup.exe needs its ".installer" folder next to it, so running
; it straight from the zip (or on its own) failed. This wraps both into one
; .exe: it unpacks them to a temp folder, runs Electrobun's installer hidden
; (it installs to %LOCALAPPDATA%\dev.aiusagebar.app and creates the Start menu
; and desktop shortcuts), then offers to launch the app.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SrcDir
  #error SrcDir must point to Electrobun's build folder (AIUsageBar-Setup.exe etc.)
#endif
#ifndef OutDir
  #define OutDir "."
#endif

#define AppLauncher "{localappdata}\dev.aiusagebar.app\stable\app\bin\launcher.exe"

[Setup]
AppId={{6E7C8B6A-3F0B-4B8E-9E55-2A4C1B7D9F31}
AppName=AIUsageBar
AppVersion={#AppVersion}
AppVerName=AIUsageBar {#AppVersion}
AppPublisher=allrpn
AppPublisherURL=https://t.me/allrpn
AppSupportURL=https://github.com/alxrepin/aiusagebar
; Everything is per-user under %LOCALAPPDATA%: no admin rights, no UAC prompt.
PrivilegesRequired=lowest
CreateAppDir=no
Uninstallable=no
DisableWelcomePage=yes
DisableReadyPage=yes
DisableProgramGroupPage=yes
WizardStyle=modern
WizardSizePercent=100
SetupIconFile=..\..\assets\icon.ico
OutputDir={#OutDir}
OutputBaseFilename=AIUsageBar-Setup
; The payload is already zstd-compressed.
Compression=none
SolidCompression=no
CloseApplications=no
ShowLanguageDialog=auto

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"

[CustomMessages]
en.Installing=Installing AIUsageBar...
ru.Installing=Установка AIUsageBar...
en.Launch=Launch AIUsageBar
ru.Launch=Запустить AIUsageBar

[Files]
Source: "{#SrcDir}\AIUsageBar-Setup.exe"; DestDir: "{tmp}\aiub"; Flags: deleteafterinstall
Source: "{#SrcDir}\AIUsageBar-Setup.tar.zst"; DestDir: "{tmp}\aiub\.installer"; Flags: deleteafterinstall
Source: "{#SrcDir}\AIUsageBar-Setup.metadata.json"; DestDir: "{tmp}\aiub\.installer"; Flags: deleteafterinstall

[Run]
Filename: "{tmp}\aiub\AIUsageBar-Setup.exe"; WorkingDir: "{tmp}\aiub"; StatusMsg: "{cm:Installing}"; Flags: runhidden waituntilterminated
Filename: "{#AppLauncher}"; WorkingDir: "{localappdata}\dev.aiusagebar.app\stable\app\bin"; Description: "{cm:Launch}"; Flags: nowait postinstall skipifdoesntexist

[Code]
// Stop a running copy first so its files can be replaced. Only processes that
// live in AIUsageBar's own folder are touched ("launcher.exe" is a common name).
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssInstall then
    Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoProfile -NonInteractive -Command "Get-Process | Where-Object { $_.Path -like ''' +
        ExpandConstant('{localappdata}') +
        '\dev.aiusagebar.app\*'' } | Stop-Process -Force -ErrorAction SilentlyContinue"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
