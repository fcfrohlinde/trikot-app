import bcrypt from 'bcryptjs';
import { kv, signToken } from '../_lib/auth.js';
import { logApiError, methodNotAllowed, requestId, serverError } from '../_lib/http.js';

// Wird nur ausgeführt, wenn noch kein User existiert.
// Damit kann der erste Admin ohne Login angelegt werden.
export default async function handler(req, res) {
  const id = requestId();
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const userCount = await kv.get('meta:userCount');
    if (userCount && userCount > 0) {
      return res.status(403).json({ error: 'Setup bereits abgeschlossen. Bitte einloggen.' });
    }

    const { username, password, name } = req.body || {};
    if (!username || !password || password.length < 8) {
      return res.status(400).json({ error: 'Benutzername und Passwort (mind. 8 Zeichen) erforderlich' });
    }
    const normalizedUsername = String(username).toLowerCase().trim();

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: `u_${Date.now()}`,
      username: normalizedUsername,
      name: name || normalizedUsername,
      passwordHash,
      role: 'admin',
      teams: [],
      permissions: null, // Admin hat keine Permissions-Flags — alles erlaubt
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };

    await kv.set(`user:${user.username}`, user);
    await kv.set('meta:userCount', 1);
    await kv.sadd('users:list', user.username);

    const token = signToken(user);
    return res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role, name: user.name, teams: [], permissions: null },
    });
  } catch (e) {
    logApiError(id, 'Setup fehlgeschlagen', e, { username: req.body?.username });
    return serverError(res, id, 'Erstinstallation derzeit nicht möglich. Bitte KV/JWT-Konfiguration prüfen.');
  }
}
