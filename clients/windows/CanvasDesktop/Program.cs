using System.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace CanvasDesktop;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new CanvasWindow());
    }
}

internal sealed class CanvasWindow : Form
{
    private const string CanvasUrl = "https://canvas.uzero.style/canvas/";
    private readonly WebView2 view = new() { Dock = DockStyle.Fill };
    private readonly Panel errorPanel = new() { Dock = DockStyle.Fill, BackColor = Color.FromArgb(248, 250, 253), Visible = false };
    private readonly Button retry = new() { Text = "再読み込み", Width = 150, Height = 44 };

    internal CanvasWindow()
    {
        Text = "キャンバス";
        Width = 1250;
        Height = 850;
        MinimumSize = new Size(500, 400);
        StartPosition = FormStartPosition.CenterScreen;

        var message = new Label
        {
            Text = "最初の起動はネット接続が必要です。接続を確認して再読み込みしてください",
            ForeColor = Color.FromArgb(31, 46, 65),
            AutoSize = true,
            Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 14, FontStyle.Regular),
            TextAlign = ContentAlignment.MiddleCenter,
        };
        var stack = new FlowLayoutPanel
        {
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            AutoSize = true,
            Anchor = AnchorStyles.None,
        };
        message.Margin = new Padding(0, 0, 0, 18);
        retry.Margin = new Padding(35, 0, 0, 0);
        stack.Controls.Add(message);
        stack.Controls.Add(retry);
        errorPanel.Controls.Add(stack);
        errorPanel.Resize += (_, _) =>
        {
            stack.Left = Math.Max(0, (errorPanel.ClientSize.Width - stack.Width) / 2);
            stack.Top = Math.Max(0, (errorPanel.ClientSize.Height - stack.Height) / 2);
        };
        retry.Click += (_, _) => { errorPanel.Visible = false; view.Reload(); };
        Controls.Add(view);
        Controls.Add(errorPanel);
        Shown += async (_, _) => await InitializeBrowser();
    }

    private async Task InitializeBrowser()
    {
        try
        {
            var dataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CanvasDesktop", "BrowserData");
            Directory.CreateDirectory(dataDir);
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: dataDir);
            await view.EnsureCoreWebView2Async(environment);
            view.CoreWebView2.Settings.IsScriptEnabled = true;
            view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            view.CoreWebView2.Settings.IsWebMessageEnabled = false;
            view.CoreWebView2.NewWindowRequested += (_, eventArgs) =>
            {
                eventArgs.Handled = true;
                OpenExternal(eventArgs.Uri);
            };
            view.CoreWebView2.NavigationStarting += (_, eventArgs) =>
            {
                if (!Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out var uri) ||
                    uri.Scheme != Uri.UriSchemeHttps)
                {
                    eventArgs.Cancel = true;
                    return;
                }
                // Keep login and document cookies in this app's browser profile.
                if (uri.Host != new Uri(CanvasUrl).Host)
                {
                    eventArgs.Cancel = true;
                    OpenExternal(eventArgs.Uri);
                }
            };
            view.CoreWebView2.NavigationCompleted += (_, args) =>
                errorPanel.Visible = !args.IsSuccess;
            view.Source = new Uri(CanvasUrl);
        }
        catch
        {
            errorPanel.Visible = true;
        }
    }

    private static void OpenExternal(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)) return;
        try { Process.Start(new ProcessStartInfo(uri.ToString()) { UseShellExecute = true }); }
        catch { }
    }
}
