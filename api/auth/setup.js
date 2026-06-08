import bcrypt from 'bcryptjs';
import { kv, setAuthCookie, signToken } from '../_lib/auth.js';
import { clientIp, logApiError, methodNotAllowed, requestId, serverError, setApiSecurityHeaders } from '../_lib/http.js';

async function assertSetupRateLimit(req) {
  const rateKey = `rate:setup:${clientIp(req)}`;
  const count = await kv.incr(rateKey);
  if (count === 1) await kv.expire(rateKey, 600);
  return count <= 5;
}

export default async function handler(req, res) {
  const id = requestId();
  setApiSecurityHeaders(res);
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const rateOk = await assertSetupRateLimit(req);
    if (!rateOk) return res.status(429).json({ error: 'Zu viele Setup-Versuche. Bitte in einigen Minuten erneut versuchen.' });

    const userCount = await kv.get('meta:userCount');
    if (userCount && userCount > 0) {
      return res.status(403).json({ error: 'Setup bereits abgeschlossen. Bitte einloggen.' });
    }

    const { username, password, name } = req.body || {};
    if (!username || !password || password.length < 8) {
      return res.status(400).json({ error: 'Benutzername und Passwort (mind. 8 Zeichen) erforderlich' });
    }
    const normalizedUsername = String(username).toLowerCase().trim();
    if (!/^[a-z0-9._-]{2,40}$/.test(normalizedUsername)) {
      return res.status(400).json({ error: 'Benutzername: nur a-z, 0-9, Punkt, Bindestrich, Unterstrich; 2-40 Zeichen.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: `u_${Date.now()}`,
      username: normalizedUsername,
      name: name || normalizedUsername,
      passwordHash,
      role: 'admin',
      teams: [],
      permissions: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };

    await kv.set(`user:${user.username}`, user);
    await kv.set('meta:userCount', 1);
    await kv.sadd('users:list', user.username);

    const token = signToken(user);
    setAuthCookie(res, token);
    return res.json({
      user: { id: user.id, username: user.username, role: user.role, name: user.name, teams: [], permissions: null },
    });
  } catch (e) {
    logApiError(id, 'Setup fehlgeschlagen', e, { username: req.body?.username });
    return serverError(res, id, 'Erstinstallation derzeit nicht moeglich. Bitte KV/JWT-Konfiguration pruefen.');
  }
}
