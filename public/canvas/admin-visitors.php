<?php
declare(strict_types=1);
require_once dirname(__DIR__, 2) . '/server/bootstrap.php';
canvas_session();
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$user = canvas_current_user();
if (!$user) {
    header('Location: /canvas/login.php?return_to=%2Fcanvas%2Fadmin-visitors.php', true, 303);
    exit;
}

try {
    $db = canvas_db();
    $q = $db->prepare('SELECT u.email FROM canvas_users u LEFT JOIN canvas_visitors v ON v.id = u.id WHERE u.id = ? AND v.id IS NULL');
    $q->execute([$user]);
    $email = $q->fetchColumn();
    if (!is_string($email) || $email === '') {
        http_response_code(403);
        exit('管理者権限がありません');
    }
    $rows = $db->query('SELECT v.id, v.nickname, v.ip_address, v.user_agent, v.visit_count, v.created_at, v.last_seen_at, '
        . 'COUNT(d.id) AS document_count, MAX(d.updated_at) AS latest_document_at '
        . 'FROM canvas_visitors v LEFT JOIN canvas_documents d ON d.owner_id = v.id '
        . 'GROUP BY v.id, v.nickname, v.ip_address, v.user_agent, v.visit_count, v.created_at, v.last_seen_at '
        . 'ORDER BY v.last_seen_at DESC LIMIT 1000')->fetchAll();
} catch (Throwable $error) {
    error_log('Canvas visitor admin error: ' . $error->getMessage());
    http_response_code(503);
    exit('DBを確認できません');
}

$e = static fn($value): string => htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$dt = static function ($milliseconds): string {
    if (!$milliseconds) return '-';
    return date('Y-m-d H:i:s', (int)floor(((int)$milliseconds) / 1000));
};
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Canvas 利用者一覧</title>
<style>
:root{font-family:system-ui,"Yu Gothic UI",sans-serif;color:#172436;background:#f4f7fb}*{box-sizing:border-box}body{margin:0;padding:24px}.wrap{max-width:1500px;margin:auto}.head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:18px}h1{margin:0;font-size:26px}p{margin:6px 0 0;color:#6c7d90}a{color:#2264df;text-decoration:none}.card{background:#fff;border:1px solid #dce5ef;border-radius:14px;overflow:auto;box-shadow:0 10px 30px #18334f0b}table{width:100%;border-collapse:collapse;min-width:1050px}th,td{padding:11px 12px;border-bottom:1px solid #edf1f6;text-align:left;font-size:13px;vertical-align:top}th{position:sticky;top:0;background:#f8fafc;color:#5e7085;font-weight:800}td strong{font-size:14px}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.ua{max-width:330px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.count{text-align:right}.empty{padding:40px;text-align:center;color:#728196}
</style>
</head>
<body><div class="wrap">
<div class="head"><div><h1>Canvas 利用者一覧</h1><p><?= $e($email) ?> / 最新1000件</p></div><a href="/">キャンバスへ戻る</a></div>
<div class="card">
<?php if (!$rows): ?><div class="empty">まだ利用記録はありません。</div><?php else: ?>
<table><thead><tr><th>ニックネーム</th><th>IP</th><th>初回</th><th>最終利用</th><th class="count">利用回数</th><th class="count">保存作品</th><th>最終作品更新</th><th>端末</th></tr></thead><tbody>
<?php foreach ($rows as $row): ?><tr>
<td><strong><?= $e($row['nickname']) ?></strong><br><span class="mono"><?= $e(substr((string)$row['id'], 0, 10)) ?>…</span></td>
<td class="mono"><?= $e($row['ip_address']) ?></td>
<td><?= $e($dt($row['created_at'])) ?></td>
<td><?= $e($dt($row['last_seen_at'])) ?></td>
<td class="count"><?= $e($row['visit_count']) ?></td>
<td class="count"><?= $e($row['document_count']) ?></td>
<td><?= $e($dt($row['latest_document_at'])) ?></td>
<td class="ua" title="<?= $e($row['user_agent']) ?>"><?= $e($row['user_agent']) ?></td>
</tr><?php endforeach; ?>
</tbody></table>
<?php endif; ?>
</div></div></body></html>
