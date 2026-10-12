package work.heartful.canvas;

/** Short production revisions and full Actions revisions identify the same bundle. */
final class WebVersions {
    static boolean sameCommit(String a, String b) {
        if (a == null || b == null || !a.matches("[a-fA-F0-9]{7,40}") || !b.matches("[a-fA-F0-9]{7,40}")) return false;
        String x = a.toLowerCase(java.util.Locale.ROOT), y = b.toLowerCase(java.util.Locale.ROOT);
        return x.startsWith(y) || y.startsWith(x);
    }
}
