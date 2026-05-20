import { kv, requireAuth } from '../_lib/auth.js';
import { logApiError, methodNotAllowed, requestId, serverError } from '../_lib/http.js';

const DATA_KEYS = ['players', 'coaches', 'inventory', 'items', 'teams', 'deposits', 'orders', 'transactions', 'reports', 'suppliers', 'settings'];

export default async function handler(req, res) {
  const id = requestId();

  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    if (req.method === 'GET') {
      const result = {};
      for (const key of DATA_KEYS) {
        const v = await kv.get(`data:${key}`);
        if (v !== null && v !== undefined) result[key] = v;
      }
      return res.json(result);
    }

    if (req.method === 'POST') {
      // Body: { key, value, mode? }. mode='mergeById' bewahrt vorhandene Einträge mit anderer ID.
      const { key, value, mode = 'replace' } = req.body || {};
      if (!DATA_KEYS.includes(key)) {
        return res.status(400).json({ error: 'Ungültiger Schlüssel' });
      }

      let nextValue = value;
      if (mode === 'mergeById') {
        if (!Array.isArray(value)) {
          return res.status(400).json({ error: 'mergeById erwartet eine Liste.' });
        }
        const current = (await kv.get(`data:${key}`)) || [];
        if (!Array.isArray(current)) {
          return res.status(400).json({ error: 'mergeById ist nur für Listen möglich.' });
        }
        const byId = new Map(current.map(entry => [entry?.id, entry]).filter(([entryId]) => entryId));
        value.forEach(entry => {
          if (entry?.id) byId.set(entry.id, { ...(byId.get(entry.id) || {}), ...entry });
        });
        nextValue = [...byId.values()];
      } else if (mode !== 'replace') {
        return res.status(400).json({ error: 'Ungültiger Speichermodus.' });
      }

      await kv.set(`data:${key}`, nextValue);
      await kv.lpush('audit:log', JSON.stringify({
        at: new Date().toISOString(),
        by: user.username,
        key,
        mode,
      }));
      await kv.ltrim('audit:log', 0, 199);
      return res.json({ ok: true });
    }

    return methodNotAllowed(res, ['GET', 'POST']);
  } catch (e) {
    logApiError(id, 'Daten-API fehlgeschlagen', e, { method: req.method, key: req.body?.key });
    return serverError(res, id, 'Daten konnten nicht geladen oder gespeichert werden. Bitte Vercel-Logs prüfen.');
  }
}
