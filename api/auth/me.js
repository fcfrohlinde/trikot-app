import { requireAuth } from '../_lib/auth.js';
import { logApiError, methodNotAllowed, requestId, serverError } from '../_lib/http.js';

// Liefert den aktuellen User-Stand aus KV — wird vom Frontend periodisch
// oder nach Speichern in der Benutzerverwaltung aufgerufen, damit nachträgliche
// Team- oder Rollen-Änderungen sofort lokal sichtbar werden.
export default async function handler(req, res) {
  const id = requestId();
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    return res.json({ user });
  } catch (e) {
    logApiError(id, 'User-Lookup fehlgeschlagen', e);
    return serverError(res, id, 'Benutzer konnte nicht geladen werden.');
  }
}
