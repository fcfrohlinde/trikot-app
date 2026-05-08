import bcrypt from 'bcryptjs';
import { kv, requireAdmin } from '../_lib/auth.js';

// Default-Permissions für die Rolle 'user' — das ist der konservative Ausgangszustand.
// Admins ignorieren diese Flags und haben immer alles.
export const DEFAULT_USER_PERMISSIONS = {
  canDeletePeople: false,    // Spieler/Trainer löschen
  canCreateOrders: true,     // Bestellungen anlegen
  canEditInventory: true,    // Material einbuchen/ausgeben/zurücknehmen
  canManageReports: true,    // Bedarfsmeldungen bearbeiten
  canManageDeposits: true,   // Pfand einnehmen/zurückzahlen
};

function normalizeTeams(teams) {
  if (!Array.isArray(teams)) return [];
  return teams.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim());
}

function normalizePermissions(perms) {
  // Wir akzeptieren nur die bekannten Flags, alles andere wird verworfen.
  const out = { ...DEFAULT_USER_PERMISSIONS };
  if (perms && typeof perms === 'object') {
    for (const key of Object.keys(DEFAULT_USER_PERMISSIONS)) {
      if (typeof perms[key] === 'boolean') out[key] = perms[key];
    }
  }
  return out;
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
      permissions: normalizePermissions(u.permissions),
      createdAt: u.createdAt,
      updatedAt: u.updatedAt || null,
    })));
  }

  if (req.method === 'POST') {
    const { username, password, name, role, teams, permissions } = req.body || {};
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
      teams: finalRole === 'admin' ? [] : normalizeTeams(teams),
      permissions: finalRole === 'admin' ? null : normalizePermissions(permissions),
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    await kv.set(`user:${u}`, user);
    await kv.sadd('users:list', u);
    await kv.incr('meta:userCount');
    return res.json({
      id: user.id, username: user.username, name: user.name,
      role: user.role, teams: user.teams,
      permissions: normalizePermissions(user.permissions),
      createdAt: user.createdAt,
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
    const { username, password, role, name, teams, permissions } = req.body || {};
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
      if (newRole === 'admin') {
        updated.teams = [];
        updated.permissions = null;
      } else if (existing.role === 'admin') {
        // Vom Admin zum User: Default-Permissions setzen, falls noch keine da
        updated.permissions = normalizePermissions(updated.permissions || permissions);
      }
    }

    if (name !== undefined) updated.name = name;

    if (teams !== undefined && updated.role !== 'admin') {
      updated.teams = normalizeTeams(teams);
    }

    if (permissions !== undefined && updated.role !== 'admin') {
      updated.permissions = normalizePermissions(permissions);
    }

    updated.updatedAt = new Date().toISOString();
    await kv.set(`user:${u}`, updated);
    return res.json({
      ok: true,
      user: {
        id: updated.id, username: updated.username, name: updated.name,
        role: updated.role, teams: updated.teams || [],
        permissions: normalizePermissions(updated.permissions),
        createdAt: updated.createdAt, updatedAt: updated.updatedAt,
      },
    });
  }

  res.status(405).end();
}
