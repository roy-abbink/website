<?php
// Franse spraakherkenning via ElevenLabs speech-to-text (Scribe).
// De opname wordt alleen doorgestuurd en direct daarna verwijderd. Dit controleert welke woorden
// zijn verstaan; het is geen uitspraakbeoordeling.

declare(strict_types=1);
require __DIR__ . '/_lib.php';

guard_request();
rate_limit('stt', 200);

$file = $_FILES['audio'] ?? null;
if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    fail('no_audio', 'Er is geen opname ontvangen.');
}
$tmp = (string)$file['tmp_name'];
register_shutdown_function(static function () use ($tmp) {
    if (is_file($tmp)) {
        @unlink($tmp);
    }
});

if ((int)$file['size'] <= 0 || (int)$file['size'] > 2_500_000) {
    fail('too_large', 'De opname is te lang. Probeer het korter.', 413);
}
$mime = (new finfo(FILEINFO_MIME_TYPE))->file($tmp) ?: '';
$allowed = ['audio/webm', 'video/webm', 'audio/mp4', 'video/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'application/octet-stream'];
if (!in_array($mime, $allowed, true)) {
    fail('bad_audio', 'Deze opname kan niet worden verwerkt.');
}

if (is_mock()) {
    $mockText = trim((string)($_POST['mock_text'] ?? ''));
    send_json(['ok' => true, 'text' => $mockText, 'reliable' => $mockText !== '', 'mock' => true]);
}

$cfg = config();
if (!elevenlabs_configured()) {
    fail('not_configured', 'Spraakherkenning is nog niet ingesteld op de server.', 503);
}

$res = transcribe($cfg, $tmp, $mime, $cfg['ELEVENLABS_STT_MODEL']);
if ($res['status'] >= 400 && $res['status'] < 500 && $cfg['ELEVENLABS_STT_MODEL'] !== 'scribe_v1') {
    // Terugval als het ingestelde model niet beschikbaar is op dit account.
    $res = transcribe($cfg, $tmp, $mime, 'scribe_v1');
}
@unlink($tmp);

if ($res['status'] !== 200) {
    log_upstream('elevenlabs-stt', $res['status']);
    fail('stt_failed', 'De spraakherkenning werkte nu niet.', 502);
}

$data = json_decode($res['body'], true) ?: [];
$text = trim((string)($data['text'] ?? ''));

// Betrouwbaarheid: lege of letterloze tekst is geen bewijs van een taalfout.
$reliable = $text !== '' && preg_match('/\p{L}/u', $text) === 1;
$logprobs = [];
foreach ($data['words'] ?? [] as $w) {
    if (($w['type'] ?? 'word') === 'word' && isset($w['logprob']) && is_numeric($w['logprob'])) {
        $logprobs[] = (float)$w['logprob'];
    }
}
if ($logprobs && array_sum($logprobs) / count($logprobs) < -1.6) {
    $reliable = false;
}

send_json(['ok' => true, 'text' => $text, 'reliable' => $reliable]);

function transcribe(array $cfg, string $tmp, string $mime, string $model): array
{
    $fields = [
        'model_id' => $model,
        'language_code' => 'fr',
        'tag_audio_events' => 'false',
        'diarize' => 'false',
        'file' => new CURLFile($tmp, $mime === 'application/octet-stream' ? 'audio/webm' : $mime, 'opname'),
    ];
    return http_call('https://api.elevenlabs.io/v1/speech-to-text', [
        ...elevenlabs_auth(),
    ], $fields, 45);
}
