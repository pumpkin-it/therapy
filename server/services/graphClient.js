// Microsoft Graph requests for the practice mailbox (app-only token from services/mailer.js).
//
// Retries: requests Graph turned away (429 throttling) are always safe to repeat. Anything else
// — 5xx, timeouts, dropped connections — is only repeated for reads; for a write (sending an
// email) we can't know whether it went through, so it's reported instead of risking a duplicate.
const { getGraphToken } = require('./mailer');

const BASE = () => process.env.GRAPH_BASE_URL || 'https://graph.microsoft.com/v1.0';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function graph(url, { method = 'GET', body, raw = false, contentType, headers = {}, timeoutMs = 120000 } = {}) {
  const full = url.startsWith('http') ? url : `${BASE()}${url}`;
  const safeToRepeat = method === 'GET';
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    let res;
    try {
      res = await fetch(full, {
        method,
        headers: {
          Authorization: `Bearer ${await getGraphToken()}`,
          // Immutable ids: an email keeps its id when someone moves it between folders.
          Prefer: 'IdType="ImmutableId", odata.maxpagesize=50',
          ...(body !== undefined ? { 'Content-Type': contentType || 'application/json' } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      lastErr = e;
      if (!safeToRepeat) { e.uncertain = true; throw e; }
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.ok) {
      if (raw) return Buffer.from(await res.arrayBuffer());
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    }
    const text = await res.text().catch(() => '');
    const err = new Error(`Graph ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    if (res.status === 429 || (safeToRepeat && res.status >= 500)) {
      lastErr = err;
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 120) * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    if (!safeToRepeat && res.status >= 500) err.uncertain = true;
    throw err;
  }
  throw lastErr;
}

module.exports = { graph };
