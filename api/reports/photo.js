import { kv, requireAuth } from '../_lib/auth.js';

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'id fehlt' });
  }

  try {
    const photo = await kv.get(`photo:${id}`);
    if (!photo) {
      return res.status(404).json({ error: 'Kein Foto vorhanden (wurde evtl. nach 90 Tagen gelöscht)' });
    }
    return res.json({ photo });
  } catch (e) {
    console.error('Foto-Abruf fehlgeschlagen', e);
    return res.status(500).json({ error: `Datenbankfehler: ${e.message}` });
  }
}

