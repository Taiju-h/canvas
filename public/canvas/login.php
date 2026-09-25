<?php
declare(strict_types=1);
require_once dirname(__DIR__, 2) . '/server/bootstrap.php';
canvas_session();
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'");

$returnTo = canvas_return_to($_POST['return_to'] ?? $_GET['return_to'] ?? '/canvas/');
$message = '';
$email = '';
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    if (!canvas_csrf_valid()) {
        $message = 'ページを更新してやり直してください';
    } else {
        $email = strtolower(trim((string)($_POST['email'] ?? '')));
        $password = (string)($_POST['password'] ?? '');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254 || strlen($password) > 1024) {
            $message = 'メールアドレスかパスワードを確認してください';
        } else {
            try {
                $db = canvas_db();
                $pepper = canvas_config()['auth']['pepper'];
                $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
                $keys = [
                    hash_hmac('sha256', $email . '|' . $ip, $pepper),
                    hash_hmac('sha256', '*|' . $ip, $pepper),
                ];
                $now = canvas_now();
                $blocked = false;
                foreach ($keys as $key) {
                    $query = $db->prepare('SELECT attempts, last_attempt_at FROM canvas_login_attempts WHERE key_hash = ?');
                    $query->execute([$key]);
                    $attempt = $query->fetch();
                    if ($attempt && $now - (int)$attempt['last_attempt_at'] < 900000 &&
                        (int)$attempt['attempts'] >= ($key === $keys[1] ? 20 : 8)) $blocked = true;
                }
                if ($blocked) {
                    http_response_code(429);
                    $message = '試行回数が多いため、15分後にお試しください';
                } else {
                    $query = $db->prepare('SELECT id, password_hash FROM canvas_users WHERE email = ?');
                    $query->execute([$email]);
                    $user = $query->fetch();
                    $hash = $user['password_hash'] ?? password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT);
                    if (!$user || !password_verify($password, $hash)) {
                        foreach ($keys as $key) {
                            $db->prepare('INSERT INTO canvas_login_attempts (key_hash, attempts, last_attempt_at) VALUES (?, 1, ?) '
                                . 'ON DUPLICATE KEY UPDATE attempts = IF(last_attempt_at < ?, 1, LEAST(attempts + 1, 65535)), last_attempt_at = ?')
                                ->execute([$key, $now, $now - 900000, $now]);
                        }
                        $message = 'メールアドレスかパスワードを確認してください';
                    } else {
                        $db->prepare('DELETE FROM canvas_login_attempts WHERE key_hash = ?')->execute([$keys[0]]);
                        session_regenerate_id(true);
                        $_SESSION['canvas_user_id'] = $user['id'];
                        $_SESSION['canvas_csrf'] = bin2hex(random_bytes(32));
                        header('Location: ' . $returnTo, true, 303);
                        exit;
                    }
                }
            } catch (Throwable $error) {
                error_log('Canvas login error: ' . $error->getMessage());
                http_response_code(503);
                $message = '保存用DBを利用できません。端末内の作品はログインなしで編集できます';
            }
        }
    }
} elseif (canvas_current_user() !== null) {
    header('Location: ' . $returnTo, true, 303);
    exit;
}
$escape = static function ($value): string {
    return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
};
?>
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ログイン | UZERO キャンバス</title>
  <style>
    :root{font-family:system-ui,"Yu Gothic UI",sans-serif;color:#18283b;background:#f4f7fc}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
    main{width:min(100%,420px);background:#fff;border:1px solid #dce5f0;border-radius:18px;padding:32px;box-shadow:0 12px 35px #162b4210}
    h1{margin:0 0 8px;font-size:24px}p{color:#63748a;line-height:1.6}label{display:block;font-size:14px;font-weight:700;margin:18px 0 7px}
    input{width:100%;height:44px;border:1px solid #cbd8e8;border-radius:9px;padding:9px 12px;font:inherit}
    button{width:100%;height:46px;border:0;border-radius:9px;background:#2467df;color:#fff;font:inherit;font-weight:700;margin-top:24px;cursor:pointer}
    a{color:#2467df;text-decoration:none}.error{padding:12px;border-radius:9px;background:#fff0ef;color:#9c3339}
  </style>
</head>
<body><main>
  <h1>キャンバスにログイン</h1>
  <p>端末間の同期と共有にはログインが必要です。ログインしなくても、この端末内の作品は編集できます。</p>
  <?php if ($message !== ''): ?><p class="error" role="alert"><?= $escape($message) ?></p><?php endif; ?>
  <form method="post" action="/canvas/login.php">
    <input type="hidden" name="csrf_token" value="<?= $escape($_SESSION['canvas_csrf']) ?>">
    <input type="hidden" name="return_to" value="<?= $escape($returnTo) ?>">
    <label for="email">メールアドレス</label><input id="email" name="email" type="email" value="<?= $escape($email) ?>" required autocomplete="username">
    <label for="password">パスワード</label><input id="password" name="password" type="password" required autocomplete="current-password">
    <button type="submit">ログイン</button>
  </form>
  <p><a href="/canvas/">端末内の作品に戻る</a></p>
</main></body></html>
