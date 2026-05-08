import { kv, requireAuth } from '../_lib/auth.js';

const DATA_KEYS = ['players', 'coaches', 'inventory', 'items', 'teams', 'deposits', 'orders', 'transactions', 'reports', 'suppliers', 'settings'];

export default async function handler(req, res) {
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
    // Body: { key, value }
    const { key, value } = req.body || {};
    if (!DATA_KEYS.includes(key)) {
      return res.status(400).json({ error: 'Ungültiger Schlüssel' });
    }
    await kv.set(`data:${key}`, value);
    // Audit-Log
    await kv.lpush('audit:log', JSON.stringify({
      at: new Date().toISOString(),
      by: user.username,
      key,
    }));
    await kv.ltrim('audit:log', 0, 199); // letzte 200 Einträge
    return res.json({ ok: true });
  }

  res.status(405).end();
}
