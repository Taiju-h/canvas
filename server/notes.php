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
