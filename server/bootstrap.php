<?php
declare(strict_types=1);

function canvas_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    session_name('uzero_canvas_session');
    session_set_cookie_params([
        'lifetime' => 0, 'path' => '/canvas/', 'secure' => $secure,
        'httponly' => true, 'samesite' => 'Lax',
    ]);
    session_start();
    if (!isset($_SESSION['canvas_csrf'])) $_SESSION['canvas_csrf'] = bin2hex(random_bytes(32));
}

function canvas_config(): array
{
    static $config = null;
    if ($config !== null) return $config;
    $path = dirname(__DIR__) . '/CONF/canvas-db.ini';
    if (!is_file($path)) throw new RuntimeException('DB未設定: CONF/canvas-db.ini が必要です');
    $parsed = parse_ini_file($path, true, INI_SCANNER_RAW);
    if (!is_array($parsed) || empty($parsed['mysql']['database']) || empty($parsed['mysql']['user']) ||
        empty($parsed['auth']['pepper']) || strlen((string)$parsed['auth']['pepper']) < 32) {
        throw new RuntimeException('DB設定が未完了です');
    }
    $config = $parsed;
    return $config;
}

function canvas_db(): PDO
{
    static $connection = null;
    if ($connection !== null) return $connection;
    $mysql = canvas_config()['mysql'];
    $dsn = !empty($mysql['unix_socket'])
        ? 'mysql:unix_socket=' . $mysql['unix_socket'] . ';dbname=' . $mysql['database'] . ';charset=utf8mb4'
        : 'mysql:host=' . ($mysql['host'] ?? 'localhost') . ';port=' . ($mysql['port'] ?? '3306') .
            ';dbname=' . $mysql['database'] . ';charset=utf8mb4';
    $connection = new PDO($dsn, $mysql['user'], $mysql['password'] ?? '', [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    return $connection;
}

function canvas_json(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function canvas_csrf_valid(): bool
{
    $submitted = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? $_POST['csrf_token'] ?? '';
    return is_string($submitted) && hash_equals((string)($_SESSION['canvas_csrf'] ?? ''), $submitted);
}

function canvas_current_user(): ?string
{
    $id = $_SESSION['canvas_user_id'] ?? null;
    return is_string($id) && preg_match('/^[a-f0-9]{32}$/', $id) ? $id : null;
}

function canvas_current_visitor(): ?string
{
    $id = $_SESSION['canvas_visitor_id'] ?? null;
    return is_string($id) && preg_match('/^[a-f0-9]{32}$/', $id) ? $id : null;
}

function canvas_current_actor(): ?string
{
    return canvas_current_user() ?? canvas_current_visitor();
}

function canvas_client_ip(): string
{
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : '';
}

function canvas_user_agent(): string
{
    $agent = trim((string)($_SERVER['HTTP_USER_AGENT'] ?? ''));
    return mb_substr($agent, 0, 255);
}

function canvas_now(): int { return (int)round(microtime(true) * 1000); }

function canvas_valid_content($value): bool
{
    if (!is_array($value) || ($value['version'] ?? null) !== 1 ||
        !isset($value['items'], $value['layers']) || !is_array($value['items']) ||
        !is_array($value['layers']) || count($value['items']) > 20000 ||
        count($value['layers']) > 100 || !in_array($value['grid'] ?? null, ['square','iso','none'], true) ||
        !is_bool($value['snap'] ?? null)) return false;
    foreach ($value['items'] as $item) {
        if (!is_array($item) || !is_string($item['id'] ?? null) || !is_string($item['kind'] ?? null)) return false;
    }
    return true;
}

function canvas_title($value): string
{
    $title = is_string($value) ? trim($value) : '';
    return $title !== '' ? mb_substr($title, 0, 80) : '新規キャンパス1';
}

function canvas_body(): array
{
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 8500000) canvas_json(['error' => '作品が大きすぎます'], 413);
    $raw = file_get_contents('php://input', false, null, 0, 8500001);
    if ($raw === false || strlen($raw) > 8500000) canvas_json(['error' => '作品が大きすぎます'], 413);
    $result = json_decode($raw, true);
    if (!is_array($result)) canvas_json(['error' => 'JSON形式が不正です'], 400);
    return $result;
}

function canvas_return_to($value): string
{
    if (!is_string($value) || substr($value, 0, 8) !== '/canvas/' ||
        strpos($value, "\r") !== false || strpos($value, "\n") !== false) return '/canvas/';
    return $value;
}
