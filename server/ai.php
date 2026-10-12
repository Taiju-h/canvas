<?php
declare(strict_types=1);

/**
 * KaeruNote AI bridge: all API credentials stay on the server.
 * Notes are sent to OpenAI only on an explicit user action.
 */
function kn_ai_key(): string
{
    return trim((string)(getenv('KAERUNOTE_OPENAI_API_KEY') ?: ''));
}
function kn_ai_guard(): void
{
    if (!canvas_current_actor()) canvas_json(['error'=>'ログインが必要です'],401);
    if (!canvas_csrf_valid()) canvas_json(['error'=>'セッションを更新してください'],403);
    if (kn_ai_key()==='') canvas_json(['error'=>'OpenAI APIキーがサーバーに設定されていません'],503);
    if (!function_exists('curl_init')) canvas_json(['error'=>'PHP cURL 拡張が必要です'],503);
    $now=time();
    $history=array_values(array_filter($_SESSION['kn_ai_rate'] ?? [],static fn($t)=>is_int($t)&&$t>$now-60));
    if (count($history)>=6) canvas_json(['error'=>'AI処理は1分間に6回までです'],429);
    $history[]=$now;$_SESSION['kn_ai_rate']=$history;
}
function kn_ai_request(string $path, array $data, bool $multipart=false): array
{
    $handle=curl_init('https://api.openai.com/v1/'.$path);
    if ($handle===false) canvas_json(['error'=>'AI接続を開始できません'],503);
    $headers=['Authorization: Bearer '.kn_ai_key()];
    if (!$multipart) $headers[]='Content-Type: application/json';
    curl_setopt_array($handle,[
        CURLOPT_POST=>true,
        CURLOPT_HTTPHEADER=>$headers,
        CURLOPT_POSTFIELDS=>$multipart?$data:json_encode($data,JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE),
        CURLOPT_RETURNTRANSFER=>true,
        CURLOPT_CONNECTTIMEOUT=>10,
        CURLOPT_TIMEOUT=>90,
        CURLOPT_FOLLOWLOCATION=>false,
        CURLOPT_SSL_VERIFYPEER=>true,
        CURLOPT_MAXREDIRS=>0,
    ]);
    $response=curl_exec($handle);$status=(int)curl_getinfo($handle,CURLINFO_HTTP_CODE);curl_close($handle);
    $result=is_string($response)?json_decode($response,true):null;
    if (!is_array($result)||$status<200||$status>=300){
        error_log('KaeruNote AI returned HTTP '.$status);
        canvas_json(['error'=>'AI処理に失敗しました。APIの設定・残高・通信状態を確認してください（HTTP '.$status.'）'],502);
    }
    return $result;
}
function kn_ai_output_text(array $response): string
{
    $pieces=[];
    foreach (($response['output'] ?? []) as $item) {
        foreach (($item['content'] ?? []) as $part) {
            if (($part['type'] ?? '')==='output_text'&&isset($part['text']))$pieces[]=(string)$part['text'];
        }
    }
    return trim(implode("\n",$pieces));
}
function kn_ai_action(PDO $db,string $actor,string $action): void
{
    kn_ai_guard();
    if ($action==='transcribe'){
        $file=$_FILES['audio'] ?? null;
        if (!is_array($file)||($file['error'] ?? -1)!==UPLOAD_ERR_OK||
            !is_uploaded_file((string)($file['tmp_name'] ?? ''))||($file['size'] ?? 0)<1||
            ($file['size'] ?? 0)>20*1024*1024) canvas_json(['error'=>'音声ファイルは20MB以内にしてください'],400);
        $name=(string)($file['name'] ?? 'recording.webm');
        $ext=strtolower(pathinfo($name,PATHINFO_EXTENSION));
        if (!in_array($ext,['mp3','mp4','mpeg','mpga','m4a','wav','webm','flac','ogg'],true))
            canvas_json(['error'=>'対応していない音声形式です'],400);
        $model=(string)(getenv('KAERUNOTE_TRANSCRIBE_MODEL') ?: 'gpt-4o-mini-transcribe');
        $result=kn_ai_request('audio/transcriptions',[
            'model'=>$model,
            'file'=>new CURLFile((string)$file['tmp_name'],(string)($file['type'] ?? 'audio/webm'),$name),
            'response_format'=>'json'
        ],true);
        canvas_json(['text'=>(string)($result['text'] ?? '')]);
    }
    if (!in_array($action,['organize','related'],true)) canvas_json(['error'=>'AI操作が見つかりません'],404);
    $body=canvas_body();
    $id=(string)($body['id'] ?? '');
    if (!preg_match('/^[a-f0-9]{32}$/D',$id)) canvas_json(['error'=>'メモIDが不正です'],400);
    $q=$db->prepare('SELECT title,content_json FROM canvas_documents WHERE id = ? AND owner_id = ? LIMIT 1');
    $q->execute([$id,$actor]);$row=$q->fetch();
    if (!$row) canvas_json(['error'=>'メモにアクセスできません'],403);
    $doc=json_decode((string)$row['content_json'],true);
    if (!is_array($doc)) canvas_json(['error'=>'ノートの内容が不正です'],400);
    $html=(string)($doc['fixedNote']['html'] ?? '');
    foreach (($doc['blocks'] ?? []) as $block)$html.="\n".(string)($block['html'] ?? '');
    $text=trim(mb_substr(html_entity_decode(strip_tags(str_replace(['</p>','<br>','</div>'],["\n","\n","\n"],$html))),0,15000));
    if ($text==='')canvas_json(['error'=>'このノートに解析対象の文章がありません'],400);
    $instruction=$action==='organize'
        ?'以下の日本語メモを整理してください。事実や数値を変えず、見出し・要点・次の作業を短くまとめます。元のメモは上書きせず提案だけ返してください。'
        :'以下のノートと候補のタイトル・分類から、関連が強い候補を最大8件選んでください。必ずJSONのみで {"related":[{"id":"32桁のID","reason":"理由"}]} と返します。根拠が弱い候補は含めないでください。';
    $candidateText='';
    if ($action==='related'){
        $q=$db->prepare('SELECT id,title,content_json FROM canvas_documents WHERE owner_id=? AND id<>? ORDER BY updated_at DESC LIMIT 150');
        $q->execute([$actor,$id]);$rows=$q->fetchAll();
        $lines=[];
        foreach($rows as $other){
            $data=json_decode((string)$other['content_json'],true) ?: [];
            $category=(string)($data['note']['category'] ?? '');
            $snippet=mb_substr(strip_tags((string)($data['fixedNote']['html'] ?? '')),0,240);
            $lines[]=$other['id'].' / '.mb_substr((string)$other['title'],0,70).' / '.mb_substr($category,0,60).' / '.$snippet;
        }
        $candidateText="\n\n候補一覧：\n".implode("\n",$lines);
    }
    $model=(string)(getenv('KAERUNOTE_AI_MODEL') ?: 'gpt-4.1-mini');
    $response=kn_ai_request('responses',[
        'model'=>$model,'instructions'=>$instruction,'max_output_tokens'=>1200,
        'input'=>"タイトル: ".(string)$row['title']."\n本文:\n".$text.$candidateText,
    ]);
    $output=kn_ai_output_text($response);
    if($action==='organize')canvas_json(['text'=>$output]);
    $decoded=json_decode($output,true);
    // Some models wrap JSON in markdown, so strip only a containing code fence.
    if(!is_array($decoded))$decoded=json_decode((string)preg_replace('/^\\x60{3}(?:json)?\\s*|\\s*\\x60{3}$/i','',$output),true);
    $listed=[];
    if(is_array($decoded)){
      foreach(($decoded['related'] ?? []) as $entry){
        if(!is_array($entry))continue;
        $relatedId=(string)($entry['id'] ?? '');
        if(!preg_match('/^[a-f0-9]{32}$/D',$relatedId))continue;
        $listed[]=['id'=>$relatedId,'reason'=>mb_substr((string)($entry['reason'] ?? ''),0,150)];
      }
    }
    canvas_json(['related'=>array_slice($listed,0,8)]);
}
