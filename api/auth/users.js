import bcrypt from 'bcryptjs';
import { kv, requireAdmin } from '../_lib/auth.js';

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    const usernames = await kv.smembers('users:list') || [];
    const users = await Promise.all(usernames.map(u => kv.get(`user:${u}`)));
    return res.json(users.filter(Boolean).map(u => ({
      id: u.id, username: u.username, name: u.name, role: u.role, createdAt: u.createdAt,
    })));
  }

  if (req.method === 'POST') {
    const { username, password, name, role } = req.body || {};
    if (!username || !password || password.length < 8) {
      return res.status(400).json({ error: 'Benutzername und Passwort (mind. 8 Zeichen)' });
    }
    const u = username.toLowerCase();
    const existing = await kv.get(`user:${u}`);
    if (existing) return res.status(400).json({ error: 'Benutzername bereits vergeben' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: `u_${Date.now()}`,
      username: u,
      name: name || u,
      passwordHash,
      role: role === 'admin' ? 'admin' : 'user',
      createdAt: new Date().toISOString(),
    };
    await kv.set(`user:${u}`, user);
    await kv.sadd('users:list', u);
    await kv.incr('meta:userCount');
    return res.json({
      id: user.id, username: user.username, name: user.name, role: user.role, createdAt: user.createdAt,
    });
  }

  if (req.method === 'DELETE') {
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ error: 'username fehlt' });
    if (username === admin.username) return res.status(400).json({ error: 'Eigenen Account nicht löschbar' });
    await kv.del(`user:${username.toLowerCase()}`);
    await kv.srem('users:list', username.toLowerCase());
    await kv.decr('meta:userCount');
    return res.json({ ok: true });
  }

  if (req.method === 'PUT') {
    const { username, password, role, name } = req.body || {};
    if (!username) return res.status(400).json({ error: 'username fehlt' });
    const u = username.toLowerCase();
    const existing = await kv.get(`user:${u}`);
    if (!existing) return res.status(404).json({ error: 'Nicht gefunden' });
    const updated = { ...existing };
    if (password && password.length >= 8) updated.passwordHash = await bcrypt.hash(password, 10);
    if (role) updated.role = role === 'admin' ? 'admin' : 'user';
    if (name) updated.name = name;
    await kv.set(`user:${u}`, updated);
    return res.json({ ok: true });
  }

  res.status(405).end();
}
