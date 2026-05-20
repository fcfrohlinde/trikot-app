import bcrypt from 'bcryptjs';
import { kv, requireAdmin } from '../_lib/auth.js';
import { logApiError, methodNotAllowed, requestId, serverError, setApiSecurityHeaders } from '../_lib/http.js';

export const DEFAULT_USER_PERMISSIONS = {
  canDeletePeople: false,
  canCreateOrders: true,
  canEditInventory: true,
  canManageReports: true,
  canManageDeposits: true,
};

function normalizeTeams(teams) {
  if (!Array.isArray(teams)) return [];
  return teams.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim());
}

function normalizePermissions(perms) {
  const out = { ...DEFAULT_USER_PERMISSIONS };
  if (perms && typeof perms === 'object') {
    for (const key of Object.keys(DEFAULT_USER_PERMISSIONS)) {
      if (typeof perms[key] === 'boolean') out[key] = perms[key];
    }
  }
  return out;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    teams: normalizeTeams(user.teams),
    permissions: user.role === 'admin' ? null : normalizePermissions(user.permissions),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt || null,
  };
}

async function adminCount() {
  const usernames = await kv.smembers('users:list') || [];
  const users = await Promise.all(usernames.map(username => kv.get(`user:${username}`)));
  return users.filter(user => user?.role === 'admin').length;
}

export default async function handler(req, res) {
  const id = requestId();
  setApiSecurityHeaders(res);

  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    if (req.method === 'GET') {
      const usernames = await kv.smembers('users:list') || [];
      const users = await Promise.all(usernames.map(username => kv.get(`user:${username}`)));
      return res.json(users.filter(Boolean).map(publicUser));
    }

    if (req.method === 'POST') {
      const { username, password, name, role, teams, permissions } = req.body || {};
      if (!username || !password || password.length < 8) return res.status(400).json({ error: 'Benutzername und Passwort (mind. 8 Zeichen)' });
      const normalizedUsername = String(username).toLowerCase().trim();
      if (!/^[a-z0-9._-]{2,40}$/.test(normalizedUsername)) return res.status(400).json({ error: 'Benutzername: nur a-z, 0-9, Punkt, Bindestrich, Unterstrich; 2-40 Zeichen.' });
      const existing = await kv.get(`user:${normalizedUsername}`);
      if (existing) return res.status(400).json({ error: 'Benutzername bereits vergeben' });

      const finalRole = role === 'admin' ? 'admin' : 'user';
      const user = {
        id: `u_${Date.now()}`,
        username: normalizedUsername,
        name: name || normalizedUsername,
        passwordHash: await bcrypt.hash(password, 10),
        role: finalRole,
        teams: finalRole === 'admin' ? [] : normalizeTeams(teams),
        permissions: finalRole === 'admin' ? null : normalizePermissions(permissions),
        createdAt: new Date().toISOString(),
        updatedAt: null,
      };
      await kv.set(`user:${normalizedUsername}`, user);
      await kv.sadd('users:list', normalizedUsername);
      await kv.incr('meta:userCount');
      return res.json(publicUser(user));
    }

    if (req.method === 'DELETE') {
      const { username } = req.body || {};
      if (!username) return res.status(400).json({ error: 'username fehlt' });
      const normalizedUsername = String(username).toLowerCase().trim();
      if (normalizedUsername === admin.username) return res.status(400).json({ error: 'Eigenen Account nicht loeschbar' });
      const existing = await kv.get(`user:${normalizedUsername}`);
      if (!existing) return res.status(404).json({ error: 'Nicht gefunden' });
      if (existing.role === 'admin' && await adminCount() <= 1) return res.status(400).json({ error: 'Mindestens ein Admin muss erhalten bleiben.' });
      await kv.del(`user:${normalizedUsername}`);
      await kv.srem('users:list', normalizedUsername);
      await kv.decr('meta:userCount');
      return res.json({ ok: true });
    }

    if (req.method === 'PUT') {
      const { username, password, role, name, teams, permissions } = req.body || {};
      if (!username) return res.status(400).json({ error: 'username fehlt' });
      const normalizedUsername = String(username).toLowerCase().trim();
      const existing = await kv.get(`user:${normalizedUsername}`);
      if (!existing) return res.status(404).json({ error: 'Nicht gefunden' });

      const updated = { ...existing };
      if (password !== undefined && password !== '') {
        if (password.length < 8) return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben.' });
        updated.passwordHash = await bcrypt.hash(password, 10);
      }
      if (role !== undefined) {
        const newRole = role === 'admin' ? 'admin' : 'user';
        if (existing.role === 'admin' && newRole === 'user' && await adminCount() <= 1) return res.status(400).json({ error: 'Mindestens ein Admin muss erhalten bleiben.' });
        updated.role = newRole;
        if (newRole === 'admin') {
          updated.teams = [];
          updated.permissions = null;
        } else if (existing.role === 'admin') {
          updated.permissions = normalizePermissions(updated.permissions || permissions);
        }
      }
      if (name !== undefined) updated.name = name;
      if (teams !== undefined && updated.role !== 'admin') updated.teams = normalizeTeams(teams);
      if (permissions !== undefined && updated.role !== 'admin') updated.permissions = normalizePermissions(permissions);
      updated.updatedAt = new Date().toISOString();

      await kv.set(`user:${normalizedUsername}`, updated);
      return res.json({ ok: true, user: publicUser(updated) });
    }

    return methodNotAllowed(res, ['GET', 'POST', 'PUT', 'DELETE']);
  } catch (e) {
    logApiError(id, 'Benutzer-API fehlgeschlagen', e, { method: req.method, username: req.body?.username });
    return serverError(res, id, 'Benutzerverwaltung derzeit nicht moeglich. Bitte Vercel-Logs pruefen.');
  }
}
