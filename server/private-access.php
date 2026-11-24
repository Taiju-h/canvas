<?php
declare(strict_types=1);

/** Personal deployment: one data owner, independently revocable device grants. */
const KN_PRIVATE_COOKIE = '__Secure-kn_device';
const KN_PRIVATE_MIN_ANDROID = '0.4.6';

final class KnPrivateError extends RuntimeException
{
    public function __construct(string $message, public int $status = 503) { parent::__construct($message); }
}

function kn_private_policy(): ?array
{
    $config = canvas_config();
    $section = $config['private_access'] ?? null;
    // An older/restored INI must never silently reopen an enrolled deployment.
    if ($section === null) {
        if (is_file(kn_private_path())) throw new KnPrivateError('個人専用設定が見つかりません。既存の端末登録は保持しています');
        return null;
    }
    if (!is_array($section) || !is_string($section['enabled'] ?? null)) throw new KnPrivateError('個人用設定を確認してください');
    $enabled = strtolower(trim($section['enabled']));
    if (in_array($enabled, ['false', '0', 'no'], true)) {
        if (is_file(kn_private_path())) throw new KnPrivateError('登録済みの保存先を一般公開には切り替えられません');
        return null;
    }
    if (!in_array($enabled, ['true', '1', 'yes'], true)) throw new KnPrivateError('個人用設定を確認してください');
    $owner = (string)($section['owner_id'] ?? '');
    if (!preg_match('/^[a-f0-9]{32}$/D', $owner)) throw new KnPrivateError('個人用データの所有者が未設定です');
    return ['owner_id' => $owner];
}

function kn_private_path(): string
{
    return (string)(getenv('CANVAS_PRIVATE_STATE_FILE') ?: dirname(__DIR__) . '/var/private-access/state.json');
}

function kn_private_read(?string $owner = null): array
{
    $raw = @file_get_contents(kn_private_path());
    $state = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($state) || ($state['version'] ?? null) !== 1 || !is_array($state['devices'] ?? null) ||
        !is_array($state['invites'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D', (string)($state['rate_salt'] ?? '')) ||
        !preg_match('/^[a-f0-9]{32}$/D', (string)($state['owner_id'] ?? '')) ||
        ($owner !== null && !hash_equals($owner, $state['owner_id']))) {
        throw new KnPrivateError('端末登録の設定を読み込めません。保存データは保持しています');
    }
    foreach ($state['devices'] as $id => $device) {
        if (!preg_match('/^[a-f0-9]{32}$/D', (string)$id) || !is_array($device) || !is_string($device['name'] ?? null) ||
            !preg_match('/^[a-f0-9]{64}$/D', (string)($device['token_hash'] ?? '')) ||
            !is_int($device['created_at'] ?? null) || !is_int($device['expires_at'] ?? null) ||
            !array_key_exists('revoked_at', $device) || ($device['revoked_at'] !== null && !is_int($device['revoked_at']))) {
            throw new KnPrivateError('端末登録の設定が不完全です。保存データは保持しています');
        }
    }
    foreach ($state['invites'] as $hash => $invite) {
        if (!preg_match('/^[a-f0-9]{64}$/D', (string)$hash) || !is_array($invite) ||
            !is_int($invite['created_at'] ?? null) || !is_int($invite['expires_at'] ?? null)) {
            throw new KnPrivateError('登録コードの設定が不完全です。保存データは保持しています');
        }
    }
    return $state;
}

/** A separate lock file stays locked while the state file is atomically replaced. */
function kn_private_update(callable $change, ?array $initial = null): mixed
{
    $path = kn_private_path();
    $directory = dirname($path);
    if (!is_dir($directory) && !mkdir($directory, 0700, true)) throw new KnPrivateError('端末登録を保存できません');
    $lock = @fopen($path . '.lock', 'c');
    if (!$lock) throw new KnPrivateError('端末登録を保存できません');
    @chmod($path . '.lock', 0600);
    try {
        if (!flock($lock, LOCK_EX)) throw new KnPrivateError('端末登録を保存できません');
        $state = $initial ?? kn_private_read(kn_private_policy()['owner_id'] ?? null);
        $result = $change($state);
        $json = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $temporary = tempnam($directory, '.state-');
        if ($temporary === false) throw new KnPrivateError('端末登録を保存できません');
        try {
            chmod($temporary, 0600);
            $file = fopen($temporary, 'wb');
            if (!$file) throw new KnPrivateError('端末登録を保存できません');
            try {
                if (fwrite($file, $json) !== strlen($json) || !fflush($file)) throw new KnPrivateError('端末登録を保存できません');
                if (function_exists('fsync') && !fsync($file)) throw new KnPrivateError('端末登録を保存できません');
            } finally { fclose($file); }
            if (!rename($temporary, $path)) throw new KnPrivateError('端末登録を保存できません');
        } finally { if (is_file($temporary)) unlink($temporary); }
        return $result;
    } finally { flock($lock, LOCK_UN); fclose($lock); }
}

function kn_private_old_android(): bool
{
    if (!preg_match('~KaeruNoteAndroid/([0-9]+\.[0-9]+\.[0-9]+)~', (string)($_SERVER['HTTP_USER_AGENT'] ?? ''), $match)) return false;
    // This is an upgrade check, never a replacement for the secret device grant.
    return version_compare($match[1], KN_PRIVATE_MIN_ANDROID, '<');
}

function kn_private_device(): ?array
{
    $policy = kn_private_policy();
    if ($policy === null) return null;
    $state = kn_private_read($policy['owner_id']);
    if (kn_private_old_android()) return null;
    $cookie = (string)($_COOKIE[KN_PRIVATE_COOKIE] ?? '');
    if (!preg_match('/^([a-f0-9]{32})\.([a-f0-9]{64})$/D', $cookie, $match)) return null;
    $device = $state['devices'][$match[1]] ?? null;
    if (!is_array($device) || !empty($device['revoked_at']) || (int)($device['expires_at'] ?? 0) <= canvas_now() ||
        !is_string($device['token_hash'] ?? null) || !hash_equals($device['token_hash'], hash('sha256', $match[2]))) return null;
    return ['id' => $match[1], 'name' => (string)($device['name'] ?? '登録端末'), 'owner_id' => $policy['owner_id']];
}

function kn_private_actor(): ?string { return kn_private_device()['owner_id'] ?? null; }

function kn_private_session_payload(): array
{
    $policy = kn_private_policy();
    if ($policy === null) throw new KnPrivateError('個人専用設定をサーバーで有効にしてください', 409);
    $device = kn_private_device();
    return [
        'privateAccess' => true, 'deviceAuthorized' => $device !== null,
        'authenticated' => $device !== null, 'memberAuthenticated' => false,
        'accountId' => $device ? $policy['owner_id'] : null,
        'deviceId' => $device['id'] ?? null, 'deviceName' => $device['name'] ?? null,
        'upgradeRequired' => kn_private_old_android(), 'minimumAndroidVersion' => KN_PRIVATE_MIN_ANDROID,
        'csrfToken' => $_SESSION['canvas_csrf'],
    ];
}

function kn_private_new_invite(array &$state, int $minutes = 15): string
{
    $now = canvas_now();
    $state['invites'] = array_filter($state['invites'], static fn($invite) => (int)($invite['expires_at'] ?? 0) > $now);
    if (count($state['invites']) >= 20) throw new KnPrivateError('未使用の登録コードが多いため、期限切れ後に再作成してください', 429);
    $code = strtoupper(bin2hex(random_bytes(16)));
    $state['invites'][hash('sha256', strtolower($code))] = ['created_at' => $now, 'expires_at' => $now + $minutes * 60000];
    return implode('-', str_split($code, 8));
}

function kn_private_enroll(string $input, string $name): array
{
    if (kn_private_old_android()) throw new KnPrivateError('新しいAndroidアプリへ上書き更新してください', 426);
    $name = trim(preg_replace('/[\x00-\x1f\x7f]/u', '', $name) ?? '');
    if ($name === '' || mb_strlen($name) > 80) throw new KnPrivateError('端末の名前を1～80文字で入力してください', 400);
    $code = strtolower(preg_replace('/[\s-]+/', '', $input) ?? '');
    return kn_private_update(static function(array &$state) use ($code, $name): array {
        $now = canvas_now();
        $rates = array_filter($state['attempts'] ?? [], static fn($r) => $now - (int)($r['at'] ?? 0) < 60000);
        $address = hash('sha256', $state['rate_salt'] . '|' . (string)($_SERVER['REMOTE_ADDR'] ?? ''));
        $global = (int)($rates['all']['count'] ?? 0);
        $local = (int)($rates[$address]['count'] ?? 0);
        if ($global >= 120 || $local >= 12) throw new KnPrivateError('登録の試行が多いため、1分後にもう一度お試しください', 429);
        $rates['all'] = ['at' => $rates['all']['at'] ?? $now, 'count' => $global + 1];
        $rates[$address] = ['at' => $rates[$address]['at'] ?? $now, 'count' => $local + 1];
        $state['attempts'] = $rates;
        $hash = hash('sha256', $code);
        $invite = $state['invites'][$hash] ?? null;
        // Return failures so the attempt counter is committed under the same lock.
        if (!preg_match('/^[a-f0-9]{32}$/D', $code) || !is_array($invite) || (int)$invite['expires_at'] <= $now) {
            return ['error' => '登録コードが違うか、使用済み・期限切れです', 'status' => 400];
        }
        $active = array_filter($state['devices'], static fn($d) => empty($d['revoked_at']) && (int)$d['expires_at'] > $now);
        if (count($active) >= 30) return ['error' => '登録できる端末は30台までです。使わない端末を解除してください', 'status' => 409];
        $id = bin2hex(random_bytes(16));
        $secret = bin2hex(random_bytes(32));
        $expires = $now + 365 * 86400000;
        $state['devices'][$id] = ['name' => $name, 'token_hash' => hash('sha256', $secret), 'created_at' => $now, 'expires_at' => $expires, 'revoked_at' => null];
        unset($state['invites'][$hash]);
        return ['cookie' => $id . '.' . $secret, 'expires_at' => $expires];
    });
}

function kn_private_set_cookie(string $value, int $expires): void
{
    // Secure remains enabled, including tests served on a trustworthy localhost origin.
    setcookie(KN_PRIVATE_COOKIE, $value, ['expires' => $expires, 'path' => '/canvas/', 'secure' => true, 'httponly' => true, 'samesite' => 'Strict']);
    if ($value === '') unset($_COOKIE[KN_PRIVATE_COOKIE]); else $_COOKIE[KN_PRIVATE_COOKIE] = $value;
}

function kn_private_revoke(string $id): bool
{
    return kn_private_update(static function(array &$state) use ($id): bool {
        if (!preg_match('/^[a-f0-9]{32}$/D', $id) || !isset($state['devices'][$id])) throw new KnPrivateError('端末が見つかりません', 404);
        $state['devices'][$id]['revoked_at'] = canvas_now();
        return true;
    });
}

function kn_private_api(string $path, string $method): void
{
    try {
        $policy = kn_private_policy();
        if ($policy === null) return;
        if ($path === '/api/session' && $method === 'GET') canvas_json(kn_private_session_payload());
        if ($path === '/api/private/activate' && $method === 'POST') {
            $localhost = in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true) &&
                preg_match('/^(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?$/D', (string)($_SERVER['HTTP_HOST'] ?? ''));
            if (!$localhost && (empty($_SERVER['HTTPS']) || $_SERVER['HTTPS'] === 'off')) throw new KnPrivateError('HTTPSで登録画面を開いてください', 400);
            if (kn_private_device() !== null) throw new KnPrivateError('この端末は登録済みです', 409);
            if (!canvas_csrf_valid()) throw new KnPrivateError('登録画面を再読み込みしてください', 403);
            $body = canvas_body();
            if (!is_string($body['code'] ?? null) || !is_string($body['name'] ?? null)) throw new KnPrivateError('端末名と登録コードを入力してください', 400);
            $result = kn_private_enroll((string)($body['code'] ?? ''), (string)($body['name'] ?? ''));
            if (isset($result['error'])) throw new KnPrivateError($result['error'], $result['status']);
            kn_private_set_cookie($result['cookie'], intdiv($result['expires_at'], 1000));
            $_SESSION = [];
            session_regenerate_id(true);
            $_SESSION['canvas_csrf'] = bin2hex(random_bytes(32));
            canvas_json(kn_private_session_payload());
        }
        $device = kn_private_device();
        if ($device === null) throw new KnPrivateError('この端末は登録されていません。ご本人の登録コードが必要です', kn_private_old_android() ? 426 : 401);
        if ($path === '/api/session' && $method === 'DELETE') {
            if (!canvas_csrf_valid()) throw new KnPrivateError('操作を再読み込みしてください', 403);
            kn_private_revoke($device['id']);
            kn_private_set_cookie('', time() - 3600);
            $_SESSION = ['canvas_csrf' => bin2hex(random_bytes(32))];
            session_regenerate_id(true);
            canvas_json(array_merge(kn_private_session_payload(), ['signedOut' => true]));
        }
        if ($path === '/api/visitor' || preg_match('~/share$~D', $path)) throw new KnPrivateError('個人専用のため、一般利用・共有リンクは無効です', 403);
        if ($path === '/api/private/devices') {
            if ($method === 'GET') {
                $state = kn_private_read($policy['owner_id']);
                $devices = [];
                foreach ($state['devices'] as $id => $entry) $devices[] = ['id' => $id, 'name' => $entry['name'], 'createdAt' => $entry['created_at'], 'expiresAt' => $entry['expires_at'], 'revokedAt' => $entry['revoked_at'], 'current' => $id === $device['id']];
                canvas_json(['devices' => $devices]);
            }
            if ($method !== 'POST') throw new KnPrivateError('操作が不正です', 405);
            if (!canvas_csrf_valid()) throw new KnPrivateError('操作を再読み込みしてください', 403);
            $body = canvas_body();
            if (($body['action'] ?? '') === 'invite') {
                $code = kn_private_update(static function(array &$state): string { return kn_private_new_invite($state); });
                canvas_json(['code' => $code, 'expiresInMinutes' => 15]);
            }
            if (($body['action'] ?? '') === 'revoke') {
                $id = (string)($body['id'] ?? '');kn_private_revoke($id);
                if ($id === $device['id']) kn_private_set_cookie('', time() - 3600);
                canvas_json(['revoked' => $id, 'currentRevoked' => $id === $device['id']]);
            }
            throw new KnPrivateError('操作が不正です', 400);
        }
    } catch (KnPrivateError $error) {
        $result = ['error' => $error->getMessage(), 'privateAccess' => true];
        if (in_array($error->status, [401, 426, 503], true)) $result['deviceAuthorized'] = false;
        canvas_json($result, $error->status);
    } catch (Throwable $error) {
        error_log('Canvas private access unavailable');
        canvas_json(['error' => '保存先の設定を読み込めません。端末のデータは保持しています', 'privateAccess' => true], 503);
    }
}
