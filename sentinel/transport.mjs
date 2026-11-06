export function remoteRpc(url, key, fetcher = fetch) {
  if (!/^https:\/\/[a-z]+\.supabase\.co$/.test(url)) throw Error('INVALID_STORAGE_HOST');
  return async (action, payload) => {
    let response;
    try {
      response = await fetcher(`${url}/rest/v1/rpc/ops01_command`, { method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload }), signal: AbortSignal.timeout(15000) });
    } catch { throw Error('STORAGE_UNAVAILABLE'); }
    if (!response.ok) throw Error('STORAGE_UNAVAILABLE');
    return response.json();
  };
}
export async function sendSlack(token, message, fetcher = fetch) {
  let response;
  try {
    response = await fetcher('https://slack.com/api/chat.postMessage', { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(message), signal: AbortSignal.timeout(10000) });
  } catch { return { outcome: 'uncertain' }; }
  if (response.status === 429) return { outcome: 'retry', retry_seconds: Math.min(86400, Math.max(60, Number(response.headers.get('retry-after')) || 60)) };
  if (!response.ok) return { outcome: response.status >= 500 ? 'uncertain' : 'blocked' };
  let data;
  try { data = await response.json(); } catch { return { outcome: 'uncertain' }; }
  if (data.ok && /^[0-9]+\.[0-9]+$/.test(data.ts ?? '')) return { outcome: 'sent', ts: data.ts };
  return { outcome: ['ratelimited', 'rate_limited'].includes(data.error) ? 'retry' : 'blocked', retry_seconds: 60 };
}
