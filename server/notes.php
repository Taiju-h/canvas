<?php
declare(strict_types=1);

/** Optional notes index. Existing canvas_documents JSON remains the source of truth. */
function canvas_notes_index(PDO $db, string $actor): array
{
    $offset = max(0, (int)($_GET['offset'] ?? 0));
    $q = $db->prepare('SELECT id, title, revision, updated_at, content_json FROM canvas_documents WHERE owner_id = ? ORDER BY updated_at DESC, id LIMIT 101 OFFSET ' . $offset);
    $q->execute([$actor]);
    $rows = $q->fetchAll();
    $more = count($rows) > 100;
    $result = [];
    foreach (array_slice($rows, 0, 100) as $row) {
        $content = json_decode($row['content_json'], true) ?: [];
        $meta = $content['note'] ?? [];
        unset($meta['sourceMarkdown'], $meta['organizationLog']);
        $texts = [];
        foreach ($content['blocks'] ?? [] as $block) $texts[] = html_entity_decode(strip_tags((string)($block['html'] ?? $block['text'] ?? '')), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        foreach ($content['items'] ?? [] as $item) if (($item['kind'] ?? '') === 'text') $texts[] = (string)($item['text'] ?? '');
        foreach ($content['attachments'] ?? [] as $attachment) $texts[] = (string)($attachment['name'] ?? '');
        $text = implode("\n", $texts);
        $result[] = ['id' => $row['id'], 'title' => $row['title'], 'revision' => (int)$row['revision'],
            'updated_at' => (int)$row['updated_at'], 'note' => $meta,
            'excerpt' => mb_substr($text, 0, 160), 'searchText' => $text];
    }
    return ['documents' => $result, 'hasMore' => $more, 'nextOffset' => $offset + 100];
}

/** Files live outside the public directory and are served only after document authorization. */
function canvas_note_file(string $docId, string $fileId, string $method): void
{
    $root = dirname(__DIR__) . '/var/attachments/' . $docId;
    if (!preg_match('/^[a-f0-9]{32}$/D', $fileId)) canvas_json(['error' => 'ファイルIDが不正です'], 400);
    $binary = $root . '/' . $fileId . '.bin';
    $manifest = $root . '/' . $fileId . '.json';
    if ($method === 'GET') {
        if (!is_file($binary) || !is_file($manifest)) canvas_json(['error' => '添付ファイルが見つかりません'], 404);
        $meta = json_decode((string)file_get_contents($manifest), true);
        $mime = $meta['mime'] ?? 'application/octet-stream';
        $inline = in_array($mime, ['image/png','image/jpeg','image/gif','image/webp','application/pdf','video/mp4','video/quicktime','audio/mpeg'], true);
        header('Content-Type: ' . ($inline ? $mime : 'application/octet-stream'));
        header("Content-Security-Policy: sandbox");
        header('Content-Disposition: ' . ($inline && !isset($_GET['download']) ? 'inline' : 'attachment') . "; filename*=UTF-8''" . rawurlencode((string)($meta['name'] ?? 'attachment')));
        header('Content-Length: ' . filesize($binary));
        session_write_close();
        readfile($binary);
        exit;
    }
    if ($method !== 'POST') canvas_json(['error' => '操作が不正です'], 405);
    $file = $_FILES['file'] ?? null;
    $offset = filter_var($_POST['offset'] ?? '', FILTER_VALIDATE_INT);
    $total = filter_var($_POST['total'] ?? '', FILTER_VALIDATE_INT);
    if ($offset === false || $total === false || $offset < 0 || $total < 1 || $total > 512 * 1024 * 1024 ||
        !is_array($file) || ($file['error'] ?? -1) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name']) ||
        $file['size'] < 1 || $file['size'] > 4 * 1024 * 1024 || $offset + $file['size'] > $total) {
        canvas_json(['error' => '添付の送信に失敗しました。PHPのupload_max_filesize/post_max_sizeを5MB以上にしてください'], 400);
    }
    if (!is_dir($root) && !mkdir($root, 0700, true) && !is_dir($root)) throw new RuntimeException('Attachment directory unavailable');
    if (is_file($binary)) {
        if (filesize($binary) !== $total) canvas_json(['error' => '既存の添付とサイズが一致しません'], 409);
        canvas_json(['nextOffset' => $total, 'complete' => true]);
    }
    $handle = fopen($binary . '.part', 'c+b');
    if (!$handle || !flock($handle, LOCK_EX)) throw new RuntimeException('Attachment lock unavailable');
    $size = fstat($handle)['size'];
    if ($offset === 0) {
        ftruncate($handle, 0);
        $size = 0;
        $name = mb_substr(basename(str_replace('\\', '/', (string)($_POST['name'] ?? 'attachment'))), 0, 255);
        if (file_put_contents($manifest . '.part', json_encode(['name' => $name, 'size' => $total], JSON_UNESCAPED_UNICODE), LOCK_EX) === false) throw new RuntimeException('Attachment metadata unavailable');
    }
    if ($size !== $offset) { fclose($handle); canvas_json(['error' => '送信位置が一致しません。再試行してください'], 409); }
    fseek($handle, $offset);
    $input = fopen($file['tmp_name'], 'rb');
    $written = stream_copy_to_stream($input, $handle);
    fclose($input);
    fflush($handle);
    $next = $offset + (int)$written;
    if ($written !== (int)$file['size']) { fclose($handle); throw new RuntimeException('Attachment write failed'); }
    if ($next === $total) {
        $meta = json_decode((string)file_get_contents($manifest . '.part'), true);
        $meta['mime'] = (new finfo(FILEINFO_MIME_TYPE))->file($binary . '.part') ?: 'application/octet-stream';
        if (file_put_contents($manifest . '.part', json_encode($meta, JSON_UNESCAPED_UNICODE), LOCK_EX) === false ||
            !rename($manifest . '.part', $manifest) || !rename($binary . '.part', $binary)) throw new RuntimeException('Attachment finalization failed');
    }
    fclose($handle);
    canvas_json(['nextOffset' => $next, 'complete' => $next === $total]);
}

/** Atomic category operations: preserve body/files and reject stale revisions. */
function canvas_note_workspace(PDO $db, string $actor, string $method): void
{
    if ($method === 'GET') {
        $q = $db->prepare('SELECT categories_json, revision FROM canvas_note_workspace WHERE owner_id = ?');
        $q->execute([$actor]);
        $row = $q->fetch();
        canvas_json(['categories' => $row ? json_decode($row['categories_json'], true) : [], 'revision' => $row ? (int)$row['revision'] : 0]);
    }
    if ($method !== 'POST') canvas_json(['error' => '操作が不正です'], 405);
    $body = canvas_body();
    $categories = $body['categories'] ?? null;
    $updates = $body['updates'] ?? null;
    if (!is_int($body['revision'] ?? null) || !is_array($categories) || count($categories) > 2000 || !is_array($updates) || count($updates) > 5000) canvas_json(['error' => 'カテゴリ操作の形式が不正です'], 400);
    foreach ($categories as $path) if (!is_string($path) || mb_strlen($path) < 1 || mb_strlen($path) > 200) canvas_json(['error' => 'カテゴリ名は1〜200文字です'], 400);
    $seen = [];
    foreach ($updates as $u) {
        if (!is_array($u) || !preg_match('/^[a-f0-9]{32}$/D', (string)($u['id'] ?? '')) || isset($seen[$u['id']]) || !is_int($u['revision'] ?? null) ||
            !is_string($u['category'] ?? null) || mb_strlen($u['category']) > 200 || !is_array($u['tags'] ?? null) || count($u['tags']) > 50) canvas_json(['error' => '分類の形式が不正です'], 400);
        foreach ($u['tags'] as $tag) if (!is_string($tag) || mb_strlen($tag) < 1 || mb_strlen($tag) > 80) canvas_json(['error' => 'タグは1〜80文字です'], 400);
        $seen[$u['id']] = true;
    }
    $db->beginTransaction();
    try {
        $db->prepare("INSERT IGNORE INTO canvas_note_workspace (owner_id, categories_json, revision) VALUES (?, '[]', 0)")->execute([$actor]);
        $q = $db->prepare('SELECT revision FROM canvas_note_workspace WHERE owner_id = ? FOR UPDATE');
        $q->execute([$actor]);
        if ((int)$q->fetchColumn() !== $body['revision']) { $db->rollBack(); canvas_json(['error' => 'カテゴリが他端末で更新されました。画面を再読み込みしてください'], 409); }
        $changed = [];
        // Stable lock order prevents simultaneous bulk changes from deadlocking.
        usort($updates, static fn($a, $b) => strcmp($a['id'], $b['id']));
        foreach ($updates as $u) {
            $q = $db->prepare('SELECT content_json, revision FROM canvas_documents WHERE id = ? AND owner_id = ? FOR UPDATE');
            $q->execute([$u['id'], $actor]);
            $row = $q->fetch();
            if (!$row || (int)$row['revision'] !== $u['revision']) { $db->rollBack(); canvas_json(['error' => '更新されたメモがあります。分類は変更していません。再読み込みしてやり直してください'], 409); }
            $content = json_decode($row['content_json'], true);
            $meta = $content['note'] ?? [];
            if (($meta['importState'] ?? '') === 'pending') { $db->rollBack(); canvas_json(['error' => '取り込み途中のメモがあります。JEX取り込みを完了してください'], 409); }
            $meta['category'] = $u['category'];
            $meta['tags'] = array_values(array_unique($u['tags']));
            $log = $meta['organizationLog'] ?? [];
            $log[] = ['at' => gmdate('c'), 'category' => $meta['category'], 'tags' => $meta['tags']];
            $meta['organizationLog'] = array_slice($log, -100);
            $content['note'] = $meta;
            $now = canvas_now();
            $json = json_encode($content, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
            if ($json === false || strlen($json) > 8000000) { $db->rollBack(); canvas_json(['error' => 'メモのサイズ上限を超えました。分類は変更していません'], 413); }
            $db->prepare('UPDATE canvas_documents SET content_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND owner_id = ?')->execute([$json, $now, $u['id'], $actor]);
            $changed[] = ['id' => $u['id'], 'revision' => $u['revision'] + 1, 'updated_at' => $now, 'note' => $meta];
        }
        $db->prepare('UPDATE canvas_note_workspace SET categories_json = ?, revision = revision + 1 WHERE owner_id = ?')->execute([json_encode(array_values(array_unique($categories)), JSON_UNESCAPED_UNICODE), $actor]);
        $db->commit();
        canvas_json(['revision' => $body['revision'] + 1, 'categories' => array_values(array_unique($categories)), 'changed' => $changed]);
    } catch (Throwable $e) { if ($db->inTransaction()) $db->rollBack(); throw $e; }
}
