import { kv } from '../_lib/auth.js';

// Liefert nur Mannschaften und Artikelnamen — keine sensiblen Daten.
// Wird vom öffentlichen Bedarfsmeldungs-Formular verwendet.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const teams = (await kv.get('data:teams')) || [];
  const items = (await kv.get('data:items')) || [];
  const settings = (await kv.get('data:settings')) || {};
  res.json({
    teams,
    items: items.map(i => ({ id: i.id, name: i.name })),
    clubName: settings.clubName || '',
  });
}
