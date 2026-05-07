import { kv, requireAuth } from '../_lib/auth.js';

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'id fehlt' });
  }

  const photo = await kv.get(`photo:${id}`);
  if (!photo) {
    return res.status(404).json({ error: 'Kein Foto vorhanden' });
  }

  // photo ist ein Data-URL string ("data:image/jpeg;base64,...")
  // Wir liefern es als JSON, weil Browser bereits Bearer-Token-Header beim normalen <img> nicht senden.
  // Frontend wandelt das selbst in einen Object-URL um oder hängt direkt das Data-URL ein.
  res.json({ photo });
}
