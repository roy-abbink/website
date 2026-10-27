<?php
// Franse spraak via ElevenLabs text-to-speech.
// Normaal en langzaam zijn twee afzonderlijke generaties met eigen spreekinstellingen,
// geen vertraagd afgespeelde of achteraf uitgerekte opname.

declare(strict_types=1);
require __DIR__ . '/_lib.php';

guard_request();
rate_limit('tts', 600);

$in = read_json_body(4096);
$text = trim((string)($in['text'] ?? ''));
$style = ($in['style'] ?? 'normal') === 'slow' ? 'slow' : 'normal';

$len = mb_strlen($text);
if ($len === 0 || $len > 160) {
    fail('bad_text', 'Deze tekst kan niet worden uitgesproken.');
}
// Alleen letters (incl. Franse tekens), spaties en eenvoudige leestekens.
if (!preg_match("/^[\\p{L}\\p{M}0-9 ,.;:!?'’\\-()«»…]+$/u", $text)) {
    fail('bad_text', 'Deze tekst kan niet worden uitgesproken.');
}

if (is_mock()) {
    mock_audio($text, $style);
}

$cfg = config();
if (!elevenlabs_configured()) {
    fail('not_configured', 'Audio is nog niet ingesteld op de server.', 503);
}

$voiceId = resolve_voice($cfg);
if ($voiceId === '') {
    fail('no_voice', 'Er is geen geschikte Franse stem gevonden.', 503);
}

$settings = $style === 'slow'
    ? ['stability' => 0.7, 'similarity_boost' => 0.8, 'style' => 0.0, 'use_speaker_boost' => true, 'speed' => 0.75]
    : ['stability' => 0.55, 'similarity_boost' => 0.8, 'style' => 0.0, 'use_speaker_boost' => true, 'speed' => 1.0];

$payload = [
    'text' => $text,
    'model_id' => $cfg['ELEVENLABS_TTS_MODEL'],
    'voice_settings' => $settings,
];
// language_code wordt alleen door de Flash/Turbo v2.5-modellen ondersteund.
if (preg_match('/(flash|turbo)_v2_5/', $cfg['ELEVENLABS_TTS_MODEL'])) {
    $payload['language_code'] = 'fr';
}

$url = 'https://api.elevenlabs.io/v1/text-to-speech/' . rawurlencode($voiceId) . '?output_format=mp3_44100_64';
$res = http_call($url, [
    ...elevenlabs_auth(),
    'Content-Type: application/json',
    'Accept: audio/mpeg',
], json_encode($payload, JSON_UNESCAPED_UNICODE), 30);

if ($res['status'] !== 200 || stripos($res['type'], 'audio') === false) {
    log_upstream('elevenlabs-tts', $res['status']);
    fail('tts_failed', 'De audio kon niet worden gemaakt.', 502);
}

header('Content-Type: audio/mpeg');
header('Cache-Control: no-store');
header('Content-Length: ' . strlen($res['body']));
echo $res['body'];
exit;

/**
 * Gebruikt ELEVENLABS_VOICE_ID als die is ingesteld. Anders zoekt de server eenmalig in de
 * stemmen van het account naar een mannelijke stem met Frans (Frankrijk) als taal/accent.
 * Alleen het stem-ID wordt tijdelijk onthouden.
 */
function resolve_voice(array $cfg): string
{
    if ($cfg['ELEVENLABS_VOICE_ID'] !== '') {
        return $cfg['ELEVENLABS_VOICE_ID'];
    }
    $cache = sys_get_temp_dir() . '/frans-oefenen-voice.txt';
    if (is_file($cache) && filemtime($cache) > time() - 86400) {
        return trim((string)file_get_contents($cache));
    }
    $res = http_get('https://api.elevenlabs.io/v1/voices', elevenlabs_auth());
    if ($res['status'] !== 200) {
        log_upstream('elevenlabs-voices', $res['status']);
        return '';
    }
    $data = json_decode($res['body'], true);
    $best = '';
    $bestScore = -1;
    foreach ($data['voices'] ?? [] as $v) {
        $labels = array_map('strtolower', array_map('strval', $v['labels'] ?? []));
        $langs = array_map(fn($l) => strtolower((string)($l['language'] ?? '') . ' ' . ($l['accent'] ?? '') . ' ' . ($l['locale'] ?? '')), $v['verified_languages'] ?? []);
        $hay = implode(' ', $labels) . ' ' . implode(' ', $langs) . ' ' . strtolower((string)($v['description'] ?? ''));
        $score = 0;
        if (($labels['gender'] ?? '') === 'male') $score += 3;
        if (preg_match('/\b(fr|french|français|fr-fr)\b/u', $hay)) $score += 4;
        if (preg_match('/parisian|standard|france/u', $hay)) $score += 1;
        if (preg_match('/canad|québ|quebec|belg|swiss|afric/u', $hay)) $score -= 3;
        if (preg_match('/warm|calm|clear|neutral|narrat/u', $hay)) $score += 1;
        if ($score > $bestScore && $score >= 7) {
            $bestScore = $score;
            $best = (string)$v['voice_id'];
        }
    }
    if ($best !== '') {
        @file_put_contents($cache, $best);
    }
    return $best;
}

/** Lokale testmodus: korte toon als WAV, langzaam = langer. Geen echte spraak. */
function mock_audio(string $text, string $style): never
{
    $rate = 8000;
    $seconds = min(4.0, 0.3 + mb_strlen($text) * ($style === 'slow' ? 0.09 : 0.05));
    $n = (int)($rate * $seconds);
    $freq = $style === 'slow' ? 330 : 440;
    $data = '';
    for ($i = 0; $i < $n; $i++) {
        $data .= pack('v', (int)(3000 * sin(2 * M_PI * $freq * $i / $rate)));
    }
    $wav = 'RIFF' . pack('V', 36 + strlen($data)) . 'WAVEfmt ' . pack('VvvVVvv', 16, 1, 1, $rate, $rate * 2, 2, 16)
        . 'data' . pack('V', strlen($data)) . $data;
    header('Content-Type: audio/wav');
    header('Cache-Control: no-store');
    header('X-Mock-Audio: 1');
    echo $wav;
    exit;
}
