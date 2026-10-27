<?php
// Gedeelde serverhulpmiddelen: configuratie, beveiliging, limieten en uitvoer.
// Bevat geen leerstof en schrijft geen inhoud van foto's, spraak of antwoorden weg.

declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');

const RATE_WINDOW_SECONDS = 3600;

function config(): array
{
    static $cfg = null;
    if ($cfg !== null) {
        return $cfg;
    }
    $cfg = [
        'ELEVENLABS_API_KEY' => '',
        // Rayane: mannelijke stem, moedertaal Frans, standaardaccent (fr-FR).
        'ELEVENLABS_VOICE_ID' => '2i5dPPF5PJ5RQSrDsmUd',
        // 1 = de sleutel wordt onderweg toegevoegd (netwerkgeheim van de ontwikkelomgeving).
        'ELEVENLABS_KEY_VIA_PROXY' => '0',
        'ELEVENLABS_TTS_MODEL' => 'eleven_multilingual_v2',
        'ELEVENLABS_STT_MODEL' => 'scribe_v2',
        'ANTHROPIC_API_KEY' => '',
        'ANTHROPIC_MODEL' => 'claude-opus-5-5',
        // Mock-modus alleen voor lokaal testen zonder externe diensten.
        'MOCK_SERVICES' => '0',
    ];
    // 1. Configuratiebestand buiten de webroot (aanbevolen op gedeelde hosting).
    //    De thuismap overleeft deploys (die doen `git clean`) en is niet via het web bereikbaar.
    $home = getenv('HOME') ?: (function_exists('posix_getpwuid') ? (posix_getpwuid(posix_geteuid())['dir'] ?? '') : '');
    $candidates = [
        getenv('FRANS_CONFIG') ?: '',
        $home !== '' ? $home . '/frans-oefenen-config.php' : '',
        dirname(__DIR__) . '/config.local.php',
    ];
    foreach ($candidates as $file) {
        if ($file !== '' && is_file($file)) {
            $loaded = require $file;
            if (is_array($loaded)) {
                $cfg = array_merge($cfg, array_intersect_key($loaded, $cfg));
            }
            break;
        }
    }
    // 2. Omgevingsvariabelen gaan voor.
    foreach (array_keys($cfg) as $key) {
        $env = getenv($key);
        if ($env !== false && $env !== '') {
            $cfg[$key] = $env;
        }
    }
    return $cfg;
}

function is_mock(): bool
{
    return config()['MOCK_SERVICES'] === '1';
}

function send_json(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $code, string $message, int $status = 400): never
{
    send_json(['ok' => false, 'error' => $code, 'message' => $message], $status);
}

/** Alleen POST vanaf dezelfde site, met een eigen header (blokkeert simpele cross-site aanroepen). */
function guard_request(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        fail('method', 'Alleen POST is toegestaan.', 405);
    }
    if (($_SERVER['HTTP_X_FRANS_OEFENEN'] ?? '') !== '1') {
        fail('forbidden', 'Ongeldige aanvraag.', 403);
    }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        $host = parse_url($origin, PHP_URL_HOST);
        $self = preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? '');
        if ($host === null || strcasecmp((string)$host, (string)$self) !== 0) {
            fail('forbidden', 'Ongeldige herkomst.', 403);
        }
    }
}

/**
 * Eenvoudige limiet per IP-adres en per uur. Slaat alleen een gehashte sleutel en een teller op,
 * in de tijdelijke map van het systeem, en ruimt verlopen tellers op.
 */
function rate_limit(string $bucket, int $max): void
{
    $dir = sys_get_temp_dir() . '/frans-oefenen-rl';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'onbekend';
    $window = intdiv(time(), RATE_WINDOW_SECONDS);
    $file = $dir . '/' . hash('sha256', $bucket . '|' . $ip . '|' . $window) . '.cnt';

    $fp = @fopen($file, 'c+');
    if ($fp === false) {
        return; // Liever doorwerken dan de oefening blokkeren als tmp niet schrijfbaar is.
    }
    flock($fp, LOCK_EX);
    $count = (int)stream_get_contents($fp);
    $count++;
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, (string)$count);
    flock($fp, LOCK_UN);
    fclose($fp);

    if (random_int(1, 50) === 1) {
        foreach (glob($dir . '/*.cnt') ?: [] as $old) {
            if (filemtime($old) < time() - 2 * RATE_WINDOW_SECONDS) {
                @unlink($old);
            }
        }
    }
    if ($count > $max) {
        fail('rate_limited', 'Even pauze: er zijn te veel aanvragen gedaan. Probeer het over een tijdje opnieuw.', 429);
    }
}

function read_json_body(int $maxBytes): array
{
    $len = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($len > $maxBytes) {
        fail('too_large', 'De upload is te groot.', 413);
    }
    $raw = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
    if ($raw === false || strlen($raw) > $maxBytes) {
        fail('too_large', 'De upload is te groot.', 413);
    }
    $data = json_decode($raw, true);
    unset($raw);
    if (!is_array($data)) {
        fail('bad_json', 'Ongeldige aanvraag.');
    }
    return $data;
}

/** HTTP-aanroep naar een externe dienst. Logt nooit de inhoud. */
function http_call(string $url, array $headers, $body, int $timeout = 60): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 10,
    ]);
    $resp = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $ctype = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $err = curl_errno($ch);
    curl_close($ch);
    if ($resp === false || $err !== 0) {
        return ['status' => 0, 'body' => '', 'type' => ''];
    }
    return ['status' => $status, 'body' => (string)$resp, 'type' => $ctype];
}

function http_get(string $url, array $headers, int $timeout = 20): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 10,
    ]);
    $resp = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return ['status' => $resp === false ? 0 : $status, 'body' => (string)$resp];
}

/** Alleen statuscode loggen, nooit de inhoud. */
function log_upstream(string $service, int $status): void
{
    error_log("frans-oefenen: $service antwoordde met status $status");
}

/** Headers voor ElevenLabs. Met een netwerkgeheim voegt de proxy de sleutel zelf toe. */
function elevenlabs_auth(): array
{
    $cfg = config();
    return $cfg['ELEVENLABS_KEY_VIA_PROXY'] === '1' ? [] : ['xi-api-key: ' . $cfg['ELEVENLABS_API_KEY']];
}

function elevenlabs_configured(): bool
{
    $cfg = config();
    return $cfg['ELEVENLABS_API_KEY'] !== '' || $cfg['ELEVENLABS_KEY_VIA_PROXY'] === '1';
}
