import bcrypt from 'bcryptjs';
import { kv, requireAdmin } from '../_lib/auth.js';

// Hilfsfunktion: Teams immer als Array sicherstellen.
// Admins haben Vollzugriff (kein Team-Filter), User können auf 1..n Mannschaften eingeschränkt werden.
function normalizeTeams(teams) {
  if (!Array.isArray(teams)) return [];
  return teams.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim());
}

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    const usernames = await kv.smembers('users:list') || [];
    const users = await Promise.all(usernames.map(u => kv.get(`user:${u}`)));
    return res.json(users.filter(Boolean).map(u => ({
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      teams: normalizeTeams(u.teams),
      createdAt: u.createdAt,
      updatedAt: u.updatedAt || null,
    })));
  }

  if (req.method === 'POST') {
    const { username, password, name, role, teams } = req.body || {};
    if (!username || !password || password.length < 8) {
      return res.status(400).json({ error: 'Benutzername und Passwort (mind. 8 Zeichen)' });
    }
    const u = username.toLowerCase().trim();
    if (!/^[a-z0-9._-]{2,40}$/.test(u)) {
      return res.status(400).json({ error: 'Benutzername: nur a–z, 0–9, Punkt, Bindestrich, Unterstrich; 2–40 Zeichen.' });
    }
    const existing = await kv.get(`user:${u}`);
    if (existing) return res.status(400).json({ error: 'Benutzername bereits vergeben' });

    const passwordHash = await bcrypt.hash(password, 10);
    const finalRole = role === 'admin' ? 'admin' : 'user';
    const user = {
      id: `u_${Date.now()}`,
      username: u,
      name: name || u,
      passwordHash,
      role: finalRole,
      // Admins ignorieren die Team-Liste in der Praxis. Wir speichern sie trotzdem leer,
      // damit ein späterer Rollenwechsel zu 'user' nicht heimlich Vollzugriff erbt.
      teams: finalRole === 'admin' ? [] : normalizeTeams(teams),
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    await kv.set(`user:${u}`, user);
    await kv.sadd('users:list', u);
    await kv.incr('meta:userCount');
    return res.json({
      id: user.id, username: user.username, name: user.name,
      role: user.role, teams: user.teams, createdAt: user.createdAt,
    });
  }

  if (req.method === 'DELETE') {
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ error: 'username fehlt' });
    if (username.toLowerCase() === admin.username) {
      return res.status(400).json({ error: 'Eigenen Account nicht löschbar' });
    }
    await kv.del(`user:${username.toLowerCase()}`);
    await kv.srem('users:list', username.toLowerCase());
    await kv.decr('meta:userCount');
    return res.json({ ok: true });
  }

  if (req.method === 'PUT') {
    const { username, password, role, name, teams } = req.body || {};
    if (!username) return res.status(400).json({ error: 'username fehlt' });
    const u = username.toLowerCase();
    const existing = await kv.get(`user:${u}`);
    if (!existing) return res.status(404).json({ error: 'Nicht gefunden' });

    const updated = { ...existing };

    // Passwort optional. Wenn gesetzt, muss es mind. 8 Zeichen haben.
    if (password !== undefined && password !== '') {
      if (password.length < 8) {
        return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben.' });
      }
      updated.passwordHash = await bcrypt.hash(password, 10);
    }

    if (role !== undefined) {
      const newRole = role === 'admin' ? 'admin' : 'user';
      // Admin-Schutz: Wenn dies der einzige Admin ist, darf er nicht zum User degradiert werden.
      if (existing.role === 'admin' && newRole === 'user') {
        const usernames = await kv.smembers('users:list') || [];
        const allUsers = await Promise.all(usernames.map(uu => kv.get(`user:${uu}`)));
        const adminCount = allUsers.filter(x => x?.role === 'admin').length;
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Mindestens ein Admin muss erhalten bleiben.' });
        }
      }
      updated.role = newRole;
      // Bei Wechsel zu Admin: Teams leeren (Admins haben Vollzugriff).
      if (newRole === 'admin') updated.teams = [];
    }

    if (name !== undefined) updated.name = name;

    if (teams !== undefined && updated.role !== 'admin') {
      updated.teams = normalizeTeams(teams);
    }

    updated.updatedAt = new Date().toISOString();
    await kv.set(`user:${u}`, updated);
    return res.json({
      ok: true,
      user: {
        id: updated.id, username: updated.username, name: updated.name,
        role: updated.role, teams: updated.teams || [],
        createdAt: updated.createdAt, updatedAt: updated.updatedAt,
      },
    });
  }

  res.status(405).end();
}
