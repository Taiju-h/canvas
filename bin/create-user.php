<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__) . '/server/bootstrap.php';

$email = strtolower(trim($argv[1] ?? ''));
if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
    fwrite(STDERR, "使い方: php canvas/bin/create-user.php you@example.com\n");
    exit(1);
}
fwrite(STDERR, "新しいパスワード（12文字以上）: ");
$tty = function_exists('posix_isatty') && posix_isatty(STDIN);
if (!$tty) {
    fwrite(STDERR, "パスワードを安全に入力するには対話型ターミナルで実行してください\n");
    exit(1);
}
system('stty -echo');
try {
    $password = rtrim((string)fgets(STDIN), "\r\n");
} finally {
    system('stty echo'); fwrite(STDERR, "\n");
}
if (strlen($password) < 12 || strlen($password) > 1024) {
    fwrite(STDERR, "パスワードは12～1024文字にしてください\n");
    exit(1);
}
try {
    $db = canvas_db();
    $exists = $db->prepare('SELECT id FROM canvas_users WHERE email = ?');
    $exists->execute([$email]);
    if ($exists->fetch()) { fwrite(STDERR, "このメールアドレスのアカウントは既にあります\n"); exit(1); }
    $db->prepare('INSERT INTO canvas_users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
        ->execute([bin2hex(random_bytes(16)), $email, password_hash($password, PASSWORD_DEFAULT), canvas_now()]);
    fwrite(STDOUT, "アカウントを作成しました: " . $email . "\n");
} catch (Throwable $error) {
    fwrite(STDERR, "DBに接続できません。設定とスキーマを確認してください\n");
    error_log('Canvas user provisioning error: ' . $error->getMessage());
    exit(1);
}
