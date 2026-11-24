package work.heartful.canvas;

/** Short production revisions and full Actions revisions identify the same bundle. */
final class WebVersions {
    // Matches the existing Vite 8 production browser baseline.
    static final int MIN_WEBVIEW_MAJOR = 111;
    static int browserMajor(String version) {
        if (version == null) return 0;
        try { return Integer.parseInt(version.split("\\.")[0]); }
        catch (NumberFormatException ignored) { return 0; }
    }
    static boolean canInstall(long candidateTime, long installedTime, long bundledTime) {
        return candidateTime > 0 && candidateTime >= Math.max(installedTime, bundledTime);
    }
    static boolean sameCommit(String a, String b) {
        if (a == null || b == null || !a.matches("[a-fA-F0-9]{7,40}") || !b.matches("[a-fA-F0-9]{7,40}")) return false;
        String x = a.toLowerCase(java.util.Locale.ROOT), y = b.toLowerCase(java.util.Locale.ROOT);
        return x.startsWith(y) || y.startsWith(x);
    }
}
