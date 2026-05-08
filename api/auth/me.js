import { requireAuth } from '../_lib/auth.js';

// Liefert den aktuellen User-Stand aus KV — wird vom Frontend periodisch
// oder nach Speichern in der Benutzerverwaltung aufgerufen, damit nachträgliche
// Team- oder Rollen-Änderungen sofort lokal sichtbar werden.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const user = await requireAuth(req, res);
  if (!user) return;
  res.json({ user });
}
