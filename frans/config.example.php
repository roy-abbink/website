<?php
// Kopieer dit bestand naar je thuismap, BUITEN de webroot:
//   ~/frans-oefenen-config.php   (op TransIP: naast de map www/)
// of zet de waarden als omgevingsvariabelen. Zet nooit echte sleutels in git.
return [
    'ELEVENLABS_API_KEY'   => '',
    // Optioneel: een vaste mannelijke Franse stem (stem-ID uit de ElevenLabs Voice Library).
    // Leeg = de server kiest automatisch een passende stem uit de stemmen in het account.
    'ELEVENLABS_VOICE_ID'  => '2i5dPPF5PJ5RQSrDsmUd', // Rayane, Frans (fr-FR), mannelijk
    'ELEVENLABS_TTS_MODEL' => 'eleven_multilingual_v2',
    'ELEVENLABS_STT_MODEL' => 'scribe_v2',
    // Voor het lezen van foto's van apprendres.
    'ANTHROPIC_API_KEY'    => '',
    'ANTHROPIC_MODEL'      => 'claude-opus-5-5',
];
