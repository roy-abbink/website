// Aanroepen naar de eigen serverlaag. API-sleutels staan alleen op de server.

const HEADERS = { 'X-Frans-Oefenen': '1' };

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function errorFrom(res) {
  let data = {};
  try { data = await res.json(); } catch { /* geen json */ }
  return new ApiError(data.error || 'http_' + res.status, data.message || 'Er ging iets mis met de verbinding.', res.status);
}

async function post(url, body, isForm = false) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: isForm ? HEADERS : { ...HEADERS, 'Content-Type': 'application/json' },
      body: isForm ? body : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('network', 'Geen verbinding met de server. Controleer het internet en probeer het opnieuw.', 0);
  }
  if (!res.ok) throw await errorFrom(res);
  return res;
}

export const api = {
  async tts(text, style) {
    const res = await post('api/tts.php', { text, style });
    return res.blob();
  },
  async stt(blob, mockText) {
    const fd = new FormData();
    const ext = blob.type.includes('mp4') || blob.type.includes('aac') ? 'm4a' : 'webm';
    fd.append('audio', blob, 'opname.' + ext);
    if (mockText) fd.append('mock_text', mockText);
    const res = await post('api/stt.php', fd, true);
    return res.json();
  },
  async recognize(images) {
    const res = await post('api/recognize.php', { images });
    return res.json();
  },
};
