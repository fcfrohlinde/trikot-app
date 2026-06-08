import { kv, requireAuth } from '../_lib/auth.js';
import { validateBusinessRules } from '../_lib/businessRules.js';
import { logApiError, methodNotAllowed, requestId, serverError, setApiSecurityHeaders } from '../_lib/http.js';
import { authorizeDataWrite, DATA_KEYS, filterDataForUser, mergeScopedWriteValue } from '../_lib/security.js';

async function loadAllData() {
  const result = {};
  for (const key of DATA_KEYS) {
    const value = await kv.get(`data:${key}`);
    result[key] = value !== null && value !== undefined ? value : (key === 'settings' ? {} : []);
  }
  return result;
}

export default async function handler(req, res) {
  const id = requestId();
  setApiSecurityHeaders(res);

  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    if (req.method === 'GET') {
      const result = await loadAllData();
      return res.json(filterDataForUser(result, user));
    }

    if (req.method === 'POST') {
      const { key, value, mode = 'replace' } = req.body || {};
      if (!DATA_KEYS.includes(key)) {
        return res.status(400).json({ error: 'Ungueltiger Schluessel' });
      }

      const allData = await loadAllData();
      const currentForKey = allData[key] ?? (key === 'settings' ? {} : []);
      let nextValue = value;

      if (mode === 'mergeById') {
        if (!Array.isArray(value)) {
          return res.status(400).json({ error: 'mergeById erwartet eine Liste.' });
        }
        if (!Array.isArray(currentForKey)) {
          return res.status(400).json({ error: 'mergeById ist nur fuer Listen moeglich.' });
        }
        const byId = new Map(currentForKey.map(entry => [entry?.id, entry]).filter(([entryId]) => entryId));
        value.forEach(entry => {
          if (entry?.id) byId.set(entry.id, { ...(byId.get(entry.id) || {}), ...entry });
        });
        nextValue = [...byId.values()];
      } else if (mode !== 'replace') {
        return res.status(400).json({ error: 'Ungueltiger Speichermodus.' });
      }

      nextValue = mergeScopedWriteValue({
        user,
        key,
        currentValue: currentForKey,
        nextValue,
        allData,
      });

      const authorization = authorizeDataWrite({
        user,
        key,
        currentValue: currentForKey,
        nextValue,
        allData,
      });
      if (!authorization.ok) {
        return res.status(authorization.status).json({ error: authorization.error });
      }

      const businessRules = validateBusinessRules({
        key,
        currentValue: currentForKey,
        nextValue,
        allData,
      });
      if (!businessRules.ok) {
        return res.status(businessRules.status).json({
          error: businessRules.error,
          code: businessRules.code,
          path: businessRules.path,
        });
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
    return serverError(res, id, 'Daten konnten nicht geladen oder gespeichert werden. Bitte Vercel-Logs pruefen.');
  }
}
