#ifndef AppVersion
  #define AppVersion "0.4.0a1"
#endif
[Setup]
AppId={{E04DBCC6-F1D3-4AD1-943F-2734E62F246F}
AppName=Agent Hub Radio
AppVersion={#AppVersion}
AppPublisher=kdkrkwhr
DefaultDirName={localappdata}\Programs\AgentHubRadio
DefaultGroupName=Agent Hub Radio
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=AgentHub-{#AppVersion}-windows-x64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\AgentHub.exe
CloseApplications=yes
RestartApplications=no
[Files]
Source: "{#BundleDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\Agent Hub Radio"; Filename: "{app}\AgentHub.exe"
Name: "{userdesktop}\Agent Hub Radio"; Filename: "{app}\AgentHub.exe"; Tasks: desktopicon
[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; Flags: unchecked
[Run]
Filename: "{app}\AgentHub.exe"; Description: "Open Agent Hub Radio"; Flags: nowait postinstall skipifsilent
; App data is outside {app}. Uninstall never removes workspaces or CLI accounts.
