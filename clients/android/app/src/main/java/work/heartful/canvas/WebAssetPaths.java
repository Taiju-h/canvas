package work.heartful.canvas;

/** URL-to-asset mapping shared by WebView and Service Worker requests. */
final class WebAssetPaths {
    // Legacy workers cache-first their known editor routes. This separate native
    // entry always reaches the APK/downloaded bundle, including after an upgrade.
    static final String NATIVE_ENTRY = "/canvas/native-shell.html";
    static boolean isEditorPath(String path) {
        return "/".equals(path) || "/index.html".equals(path) || "/canvas".equals(path) ||
            "/canvas/".equals(path) || "/canvas/index.html".equals(path) || NATIVE_ENTRY.equals(path);
    }
    static String relative(String path) {
        if (path == null) return null;
        if (NATIVE_ENTRY.equals(path)) return "index.html";
        String value;
        if (path.equals("/") || path.equals("/index.html") || path.equals("/canvas")) return "index.html";
        if (path.startsWith("/canvas/")) value = path.substring(8);
        else if (path.startsWith("/")) value = path.substring(1);
        else return null;
        if (value.isEmpty()) return "index.html";
        if (value.startsWith("/") || value.contains("\\") || value.indexOf('\0') >= 0) return null;
        for (String part : value.split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..")) return null;
        }
        if (value.endsWith(".php")) return null;
        if (value.startsWith("assets/")) return value;
        switch (value) {
            case "index.html": case "offline-assets.json": case "build-version.json":
            case "manifest.webmanifest": case "favicon.svg": case "sw.js": return value;
            default: return null;
        }
    }
}
