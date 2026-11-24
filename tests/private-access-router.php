<?php
declare(strict_types=1);
// Only used by the isolated CI PHP development server; never placed in public/.
require_once dirname(__DIR__) . '/server/bootstrap.php';
canvas_session();
$route = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
if ($route === '/test/legacy') {
    $_SESSION['canvas_user_id'] = str_repeat('b', 32);
    $_SESSION['canvas_visitor_id'] = str_repeat('b', 32);
    $_SESSION['canvas_shared_resource_grants'][str_repeat('d', 32)] = hash('sha256', str_repeat('9', 64));
    canvas_json(['fixture' => true]);
}
if ($route === '/test/actor') {
    kn_private_api('/api/test-actor', 'GET');
    canvas_json(['actor' => canvas_current_actor()]);
}
if ($route === '/canvas/api.php') { require dirname(__DIR__) . '/public/canvas/api.php'; exit; }
if ($route === '/canvas/login.php') { require dirname(__DIR__) . '/public/canvas/login.php'; exit; }
if ($route === '/canvas/admin-visitors.php') { require dirname(__DIR__) . '/public/canvas/admin-visitors.php'; exit; }
http_response_code(404);
