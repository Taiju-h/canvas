# Windows 版

Visual Studio または .NET 8 SDK が入った Windows でビルドします。

1. `CanvasDesktop/CanvasDesktop.csproj` を開きます。
2. Windows の PowerShell でこのディレクトリから次を実行します。

   `dotnet publish .\CanvasDesktop\CanvasDesktop.csproj -c Release -r win-x64 --self-contained true -o .\publish`

3. Inno Setup で `installer.iss` をコンパイルすると `output/CanvasDesktop-Setup.exe` ができます。

WebView2 Runtime が必要です。Windows 11 の多くの環境には搭載されていますが、ない環境では Microsoft の公式ランタイムを導入してください。
アプリは同じキャンバスを専用ウィンドウで開きます。最初にオンラインで起動して画面を保存した後は端末の作品をオフラインで編集できます。作品の同期にはインターネット接続が必要です。
