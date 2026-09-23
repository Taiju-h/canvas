#define AppName "キャンバス"
#define AppVersion "0.1.0"
#define AppExe "CanvasDesktop.exe"

[Setup]
AppId={{9A925D46-28D8-4D27-8C4A-4CB77CC09E71}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={autopf}\CanvasDesktop
DefaultGroupName={#AppName}
OutputDir=output
OutputBaseFilename=CanvasDesktop-Setup
Compression=lzma
SolidCompression=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64

[Files]
Source: "publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "デスクトップにアイコンを作る"; Flags: unchecked

[Run]
Filename: "{app}\{#AppExe}"; Description: "キャンバスを起動"; Flags: nowait postinstall skipifsilent
