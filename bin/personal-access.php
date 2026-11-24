#!/usr/bin/env php
<?php
declare(strict_types=1);
// Run on the Canvas server. Secrets are generated there, never in a release or Git.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__) . '/server/bootstrap.php';

function personal_fail(string $message): never { fwrite(STDERR, $message . "\n"); exit(1); }
function personal_web_owner(): void
{
    if (!function_exists('posix_geteuid') || posix_geteuid() !== 0) return;
    $user = (string)(getenv('CANVAS_PHP_USER') ?: 'www-data');
    $entry = posix_getpwnam($user);
    if (!$entry) personal_fail('CANVAS_PHP_USERでPHPの実行ユーザーを指定してください');
    $path = kn_private_path();
    foreach ([dirname($path), $path, $path . '.lock'] as $file) {
        if (!chown($file, $entry['uid']) || !chgrp($file, $entry['gid'])) personal_fail('端末登録ファイルの所有者を変更できません: ' . $file);
    }
}
function personal_code(int $minutes): void
{
    $code = kn_private_update(static function(array &$state) use ($minutes): string { return kn_private_new_invite($state, $minutes); });
    personal_web_owner();
    echo "登録URL: https://canvas.uzero.style/canvas/\n1端末で1回だけ使える登録コード（{$minutes}分有効）:\n{$code}\n";
    echo "コードは公開・転送せず、ご本人の端末だけに入力してください。\n";
}

$command = $argv[1] ?? 'help';
try {
    if ($command === 'setup') {
        if (kn_private_policy() !== null) personal_fail('個人専用設定は有効です。新しい端末は invite で追加してください');
        if (is_file(kn_private_path())) personal_fail('既存の端末登録ファイルがあります。自動で上書きしません');
        // Choose the actual owner: never guess from an email, merge accounts, or create a new empty owner.
        $users = canvas_db()->query('SELECT u.id, COALESCE(v.nickname, u.email) AS label, '
            . '(SELECT COUNT(*) FROM canvas_documents d WHERE d.owner_id = u.id) AS notes '
            . 'FROM canvas_users u LEFT JOIN canvas_visitors v ON v.id = u.id ORDER BY notes DESC, u.created_at, u.id')->fetchAll();
        if (!$users) personal_fail('既存の利用者が見つかりません。個人データの保存先を確認してください');
        echo "既存データの所有者を選びます。他の利用者のデータは統合・削除しません。\n";
        foreach ($users as $i => $user) printf("%d: %s / %d件 / %s\n", $i + 1, $user['label'], $user['notes'], $user['id']);
        echo 'ご本人の行番号: ';
        $selection = trim((string)fgets(STDIN));
        if (!ctype_digit($selection) || !isset($users[(int)$selection - 1])) personal_fail('行番号が不正です。設定は変更していません');
        $owner = $users[(int)$selection - 1]['id'];
        $initial = ['version' => 1, 'owner_id' => $owner, 'rate_salt' => bin2hex(random_bytes(32)), 'devices' => [], 'invites' => []];
        kn_private_update(static function(array &$state): void {}, $initial);
        personal_web_owner();
        $configPath = canvas_config_path();
        $config = (string)file_get_contents($configPath);
        // Preserve database/auth settings verbatim. Only replace this optional section.
        $config = preg_replace('/^\[private_access\][^\n]*\n.*?(?=^\[|\z)/ms', '', $config) ?? $config;
        $config .= "\n[private_access]\nenabled = true\nowner_id = \"{$owner}\"\n";
        $temporary = tempnam(dirname($configPath), '.private-config-');
        if (!$temporary) personal_fail('設定を書き込めません');
        try {
            if (file_put_contents($temporary, $config) !== strlen($config)) personal_fail('設定を書き込めません');
            chmod($temporary, fileperms($configPath) & 0777);
            if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
                chown($temporary, fileowner($configPath)); chgrp($temporary, filegroup($configPath));
            }
            if (!rename($temporary, $configPath)) personal_fail('設定を置き換えられません');
        } finally { if (is_file($temporary)) unlink($temporary); }
        // canvas_config() is cached in this process; use the chosen owner explicitly here.
        $code = kn_private_update(static function(array &$state): string { return kn_private_new_invite($state, 60); });
        personal_web_owner();
        echo "個人専用を有効にしました。ノート・添付の移動や削除はしていません。\n";
        echo "登録URL: https://canvas.uzero.style/canvas/\n最初の1台の登録コード（60分有効・1回限り）:\n{$code}\n";
        echo "追加のPC・iPadは、登録した端末の「自分の端末」からコードを発行できます。\n";
    } elseif ($command === 'invite') {
        if (kn_private_policy() === null) personal_fail('先に setup を実行してください');
        personal_code(60);
    } elseif ($command === 'devices') {
        $policy = kn_private_policy();
        if ($policy === null) personal_fail('先に setup を実行してください');
        foreach (kn_private_read($policy['owner_id'])['devices'] as $id => $device) {
            $status = !empty($device['revoked_at']) ? '解除済み' : ((int)$device['expires_at'] <= canvas_now() ? '期限切れ' : '有効');
            printf("%s\t%s\t%s\n", $id, $status, $device['name']);
        }
    } elseif ($command === 'revoke') {
        if (kn_private_policy() === null) personal_fail('先に setup を実行してください');
        kn_private_revoke((string)($argv[2] ?? '')); personal_web_owner();
        echo "端末のサーバー利用許可を解除しました。保存データは削除していません。\n";
    } else {
        echo "サーバー上で実行:\n  sudo php bin/personal-access.php setup\n  sudo php bin/personal-access.php invite\n  sudo php bin/personal-access.php devices\n  sudo php bin/personal-access.php revoke <端末ID>\n";
    }
} catch (Throwable $error) {
    personal_fail('個人専用設定を完了できません: ' . $error->getMessage());
}
