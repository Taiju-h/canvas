<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli' || getenv('CANVAS_PRIVATE_TEST_DB') !== '1') exit(1);
require_once dirname(__DIR__) . '/server/bootstrap.php';
$db = canvas_db();
$db->exec((string)file_get_contents(dirname(__DIR__) . '/sql/schema.mysql.sql'));
$content = json_encode(['version' => 1, 'grid' => 'none', 'snap' => false, 'items' => [], 'layers' => [], 'fixedNote' => ['html' => '<p>synthetic private note</p>']]);
foreach (['a', 'b'] as $letter) $db->prepare('INSERT INTO canvas_users (id,email,password_hash,created_at) VALUES (?,?,?,?)')->execute([str_repeat($letter,32),$letter.'@test.invalid','unusable',1]);
foreach ([['c','a','e'], ['d','b','f']] as [$doc, $owner, $image]) {
    $db->prepare('INSERT INTO canvas_documents (id,owner_id,title,content_json,revision,share_hash,created_at,updated_at) VALUES (?,?,?,?,1,?,1,1)')
        ->execute([str_repeat($doc,32),str_repeat($owner,32),'Synthetic '.$doc,$content,hash('sha256',str_repeat('9',64))]);
    $db->prepare('INSERT INTO canvas_images (id,document_id,content_type,image_blob,created_at) VALUES (?,?,?,?,1)')
        ->execute([str_repeat($image,32),str_repeat($doc,32),'image/png','synthetic-image-'.$doc]);
    $directory = dirname(__DIR__) . '/var/attachments/' . str_repeat($doc,32);
    if (!is_dir($directory)) mkdir($directory,0700,true);
    file_put_contents($directory . '/' . str_repeat('8',32) . '.bin', 'synthetic-attachment-'.$doc);
    file_put_contents($directory . '/' . str_repeat('8',32) . '.json', '{"name":"synthetic.txt","mime":"text/plain"}');
}
