<?php
declare(strict_types=1);
require_once dirname(__DIR__, 2) . '/server/bootstrap.php';
canvas_session();

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$path = $_GET['path'] ?? '';
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
if (!is_string($path)) canvas_json(['error' => '経路が不正です'], 400);

if ($path === '/api/session') {
    if ($method === 'GET') {
        $member = canvas_current_user();
        $visitor = canvas_current_visitor();
        $actor = $member ?? $visitor;
        $nickname = null;
        if ($visitor !== null) {
            try {
                $db = canvas_db();
                $now = canvas_now();
                $db->prepare('UPDATE canvas_visitors SET ip_address = ?, user_agent = ?, last_seen_at = ? WHERE id = ?')
                    ->execute([canvas_client_ip(), canvas_user_agent(), $now, $visitor]);
                $q = $db->prepare('SELECT nickname FROM canvas_visitors WHERE id = ?');
                $q->execute([$visitor]);
                $nickname = $q->fetchColumn() ?: null;
            } catch (Throwable $error) {
                error_log('Canvas visitor touch error: ' . $error->getMessage());
            }
        }
        canvas_json([
            'authenticated' => $actor !== null,
            'memberAuthenticated' => $member !== null,
            'accountId' => $actor,
            'nickname' => $nickname,
            'csrfToken' => $_SESSION['canvas_csrf'],
        ]);
    }
    if ($method === 'DELETE') {
        if (!canvas_csrf_valid()) canvas_json(['error' => '操作を再読み込みしてください'], 403);
        $_SESSION = [];
        session_regenerate_id(true);
        $_SESSION['canvas_csrf'] = bin2hex(random_bytes(32));
        canvas_json(['signedOut' => true]);
    }
    canvas_json(['error' => '操作が不正です'], 405);
}

if ($path === '/api/visitor') {
    if ($method !== 'POST') canvas_json(['error' => '操作が不正です'], 405);
    if (!canvas_csrf_valid()) canvas_json(['error' => '操作を再読み込みしてください'], 403);
    $body = canvas_body();
    $nickname = trim((string)($body['nickname'] ?? ''));
    if ($nickname === '' || mb_strlen($nickname) > 40) canvas_json(['error' => 'ニックネームは1～40文字で入力してください'], 400);
    $providedToken = strtolower(trim((string)($body['visitorToken'] ?? '')));
    if ($providedToken !== '' && !preg_match('/^[a-f0-9]{64}$/D', $providedToken)) $providedToken = '';

    try {
        $db = canvas_db();
        $now = canvas_now();
        $visitorId = null;
        $tokenToReturn = $providedToken;
        if ($providedToken !== '') {
            $q = $db->prepare('SELECT id FROM canvas_visitors WHERE token_hash = ?');
            $q->execute([hash('sha256', $providedToken)]);
            $found = $q->fetchColumn();
            if (is_string($found) && preg_match('/^[a-f0-9]{32}$/D', $found)) $visitorId = $found;
        }

        if ($visitorId !== null) {
            $db->prepare('UPDATE canvas_visitors SET nickname = ?, ip_address = ?, user_agent = ?, '
                . 'visit_count = visit_count + 1, last_seen_at = ? WHERE id = ?')
                ->execute([$nickname, canvas_client_ip(), canvas_user_agent(), $now, $visitorId]);
        } else {
            $visitorId = bin2hex(random_bytes(16));
            $tokenToReturn = bin2hex(random_bytes(32));
            $shadowEmail = 'visitor+' . $visitorId . '@canvas.invalid';
            $shadowPassword = password_hash(bin2hex(random_bytes(32)), PASSWORD_DEFAULT);
            if (!is_string($shadowPassword)) throw new RuntimeException('visitor password hash failed');
            $db->beginTransaction();
            try {
                $db->prepare('INSERT INTO canvas_users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
                    ->execute([$visitorId, $shadowEmail, $shadowPassword, $now]);
                $db->prepare('INSERT INTO canvas_visitors '
                    . '(id, nickname, token_hash, ip_address, user_agent, visit_count, created_at, last_seen_at) '
                    . 'VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
                    ->execute([$visitorId, $nickname, hash('sha256', $tokenToReturn), canvas_client_ip(), canvas_user_agent(), $now, $now]);
                $db->commit();
            } catch (Throwable $error) {
                if ($db->inTransaction()) $db->rollBack();
                throw $error;
            }
        }

        session_regenerate_id(true);
        $_SESSION['canvas_visitor_id'] = $visitorId;
        $_SESSION['canvas_csrf'] = bin2hex(random_bytes(32));
        canvas_json([
            'authenticated' => true,
            'memberAuthenticated' => false,
            'accountId' => $visitorId,
            'nickname' => $nickname,
            'visitorToken' => $tokenToReturn,
            'csrfToken' => $_SESSION['canvas_csrf'],
        ], 201);
    } catch (Throwable $error) {
        error_log('Canvas visitor registration error: ' . $error->getMessage());
        canvas_json(['error' => '利用者情報を保存できません'], 503);
    }
}

if ($path === '/api/next-title') {
    if ($method !== 'GET') canvas_json(['error' => '操作が不正です'], 405);
    $actor = canvas_current_actor();
    if (!$actor) canvas_json(['error' => '利用者情報を入力してください'], 401);
    try {
        $q = canvas_db()->prepare("SELECT title FROM canvas_documents WHERE owner_id = ? AND title LIKE '新規キャンパス%' LIMIT 1000");
        $q->execute([$actor]);
        $max = 0;
        foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $title) {
            if (is_string($title) && preg_match('/^新規キャンパス([0-9]+)$/u', $title, $m)) $max = max($max, (int)$m[1]);
        }
        canvas_json(['number' => $max + 1, 'title' => '新規キャンパス' . ($max + 1)]);
    } catch (Throwable $error) {
        error_log('Canvas next title error: ' . $error->getMessage());
        canvas_json(['error' => '作品名を準備できません'], 503);
    }
}

if (!preg_match('~^/api/documents(?:/([a-f0-9]{32}))?(?:/(share|images)(?:/([a-f0-9]{32}))?)?$~D', $path, $match)) {
    canvas_json(['error' => '操作が見つかりません'], 404);
}
if (!in_array($method, ['GET', 'HEAD'], true) && !canvas_csrf_valid()) {
    canvas_json(['error' => '操作を再読み込みしてください'], 403);
}

try {
    $db = canvas_db();
    $actor = canvas_current_actor();
    $id = $match[1] ?? '';
    $operation = $match[2] ?? '';
    $imageId = $match[3] ?? '';

    if ($id === '') {
        if (!$actor) canvas_json(['error' => '利用者情報を入力してください'], 401);
        if ($method === 'GET') {
            $query = $db->prepare('SELECT id, title, revision, updated_at FROM canvas_documents WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 100');
            $query->execute([$actor]);
            canvas_json(['documents' => $query->fetchAll(), 'accountId' => $actor]);
        }
        if ($method !== 'POST') canvas_json(['error' => '操作が不正です'], 405);
        $body = canvas_body();
        $content = $body['content'] ?? [
            'version' => 1, 'items' => [],
            'layers' => [['id' => bin2hex(random_bytes(16)), 'name' => 'レイヤー 1', 'visible' => true, 'locked' => false]],
            'grid' => 'square', 'snap' => true,
        ];
        if (!canvas_valid_content($content)) canvas_json(['error' => '作品の形式が不正です'], 400);
        $json = json_encode($content, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        if ($json === false || strlen($json) > 8000000) canvas_json(['error' => '作品が大きすぎます'], 413);
        $id = bin2hex(random_bytes(16));
        $now = canvas_now();
        $title = canvas_title($body['title'] ?? null);
        $db->prepare('INSERT INTO canvas_documents (id, owner_id, title, content_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
            ->execute([$id, $actor, $title, $json, $now, $now]);
        canvas_json(['id' => $id, 'title' => $title, 'revision' => 1, 'updated_at' => $now, 'content' => $content], 201);
    }

    $query = $db->prepare('SELECT id, owner_id, title, content_json, revision, share_hash, updated_at FROM canvas_documents WHERE id = ?');
    $query->execute([$id]);
    $doc = $query->fetch();
    if (!$doc) canvas_json(['error' => 'この作品を開く権限がありません'], 403);
    $owner = $actor && hash_equals($doc['owner_id'], $actor);
    $token = (string)($_SERVER['HTTP_X_SHARE_TOKEN'] ?? '');
    $guest = !$owner && preg_match('/^[a-f0-9]{64}$/D', $token) &&
        is_string($doc['share_hash']) && hash_equals($doc['share_hash'], hash('sha256', $token));
    if (!$owner && !$guest) canvas_json(['error' => 'この作品を開く権限がありません'], 403);

    if ($operation === 'share') {
        if ($method !== 'POST' || !$owner) canvas_json(['error' => '権限がありません'], 403);
        $action = canvas_body()['action'] ?? '';
        if ($action === 'revoke') {
            $db->prepare('UPDATE canvas_documents SET share_hash = NULL WHERE id = ?')->execute([$id]);
            canvas_json(['revoked' => true]);
        }
        if ($action !== 'create') canvas_json(['error' => '操作が不正です'], 400);
        $secret = bin2hex(random_bytes(32));
        $db->prepare('UPDATE canvas_documents SET share_hash = ? WHERE id = ?')->execute([hash('sha256', $secret), $id]);
        canvas_json(['token' => $secret]);
    }

    if ($operation === 'images') {
        if ($imageId !== '') {
            if ($method !== 'GET') canvas_json(['error' => '操作が不正です'], 405);
            $query = $db->prepare('SELECT content_type, image_blob FROM canvas_images WHERE document_id = ? AND id = ?');
            $query->execute([$id, $imageId]);
            $image = $query->fetch();
            if (!$image) canvas_json(['error' => '画像が見つかりません'], 404);
            header('Content-Type: ' . $image['content_type']);
            header('Cache-Control: private, no-store');
            echo $image['image_blob'];
            exit;
        }
        if ($method !== 'POST') canvas_json(['error' => '操作が不正です'], 405);
        $file = $_FILES['file'] ?? null;
        if (!is_array($file) || ($file['error'] ?? -1) !== UPLOAD_ERR_OK ||
            !isset($file['size'], $file['tmp_name']) || $file['size'] < 1 || $file['size'] > 10000000 ||
            !is_uploaded_file($file['tmp_name'])) canvas_json(['error' => '10MB以下の画像を選んでください'], 400);
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
        if (!in_array($mime, ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], true) ||
            getimagesize($file['tmp_name']) === false) canvas_json(['error' => '画像形式が不正です'], 400);
        $binary = file_get_contents($file['tmp_name']);
        if ($binary === false) canvas_json(['error' => '画像を読めません'], 400);
        $imageId = bin2hex(random_bytes(16));
        $db->prepare('INSERT INTO canvas_images (id, document_id, content_type, image_blob, created_at) VALUES (?, ?, ?, ?, ?)')
            ->execute([$imageId, $id, $mime, $binary, canvas_now()]);
        canvas_json(['imageId' => $imageId], 201);
    }

    if ($method === 'GET') {
        if ((string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === (string)$doc['revision']) {
            http_response_code(304);
            exit;
        }
        header('ETag: ' . $doc['revision']);
        canvas_json(['id' => $id, 'title' => $doc['title'], 'revision' => (int)$doc['revision'],
            'updated_at' => (int)$doc['updated_at'],
            'content' => json_decode($doc['content_json'], true), 'owner' => (bool)$owner]);
    }
    if ($method === 'DELETE') {
        if (!$owner) canvas_json(['error' => '権限がありません'], 403);
        $db->prepare('DELETE FROM canvas_documents WHERE id = ? AND owner_id = ?')->execute([$id, $actor]);
        canvas_json(['deleted' => true]);
    }
    if ($method !== 'PUT') canvas_json(['error' => '操作が不正です'], 405);
    $body = canvas_body();
    if (!is_int($body['revision'] ?? null) || !canvas_valid_content($body['content'] ?? null)) {
        canvas_json(['error' => '保存データが不正です'], 400);
    }
    $json = json_encode($body['content'], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($json === false || strlen($json) > 8000000) canvas_json(['error' => '作品が大きすぎます'], 413);
    $title = canvas_title($body['title'] ?? null);
    $now = canvas_now();
    $update = $db->prepare('UPDATE canvas_documents SET title = ?, content_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?');
    $update->execute([$title, $json, $now, $id, $body['revision']]);
    if ($update->rowCount() !== 1) canvas_json(['error' => 'ほかの端末の変更が先に保存されました'], 409);
    canvas_json(['id' => $id, 'title' => $title, 'revision' => $body['revision'] + 1, 'updated_at' => $now]);
} catch (Throwable $error) {
    error_log('Canvas storage error: ' . $error->getMessage());
    canvas_json(['error' => '保存先に接続できません。端末の作品は保持されます'], 503);
}
