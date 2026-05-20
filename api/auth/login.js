import bcrypt from 'bcryptjs';
import { kv, signToken } from '../_lib/auth.js';
import { logApiError, methodNotAllowed, requestId, serverError } from '../_lib/http.js';

export default async function handler(req, res) {
  const id = requestId();
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
    }

    const normalizedUsername = String(username).toLowerCase().trim();
    const user = await kv.get(`user:${normalizedUsername}`);
    if (!user) {
      return res.status(401).json({ error: 'Falsche Zugangsdaten' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Falsche Zugangsdaten' });
    }

    const token = signToken(user);
    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name,
        teams: Array.isArray(user.teams) ? user.teams : [],
        permissions: user.permissions || null,
      },
    });
  } catch (e) {
    logApiError(id, 'Login fehlgeschlagen', e, { username: req.body?.username });
    return serverError(res, id, 'Login derzeit nicht möglich. Bitte Konfiguration und Vercel-Logs prüfen.');
  }
}
