import { kv } from '../_lib/auth.js';
import { logApiError, methodNotAllowed, requestId, serverError } from '../_lib/http.js';

export default async function handler(req, res) {
  const id = requestId();
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const userCount = (await kv.get('meta:userCount')) || 0;
    return res.json({ setupRequired: userCount === 0 });
  } catch (e) {
    logApiError(id, 'Auth-Status fehlgeschlagen', e);
    return serverError(res, id, 'Auth-Status konnte nicht geladen werden. Bitte KV-Konfiguration prüfen.');
  }
}
