import bcrypt from 'bcryptjs';
import { kv, setAuthCookie, signToken } from '../_lib/auth.js';
import { clientIp, logApiError, methodNotAllowed, requestId, safeLogValue, serverError, setApiSecurityHeaders } from '../_lib/http.js';

async function assertLoginRateLimit(req, username) {
  const ip = clientIp(req);
  const normalized = safeLogValue(username || 'unknown').toLowerCase() || 'unknown';
  const ipKey = `rate:login:ip:${ip}`;
  const userKey = `rate:login:user:${normalized}`;
  const [ipCount, userCount] = await Promise.all([kv.incr(ipKey), kv.incr(userKey)]);
  if (ipCount === 1) await kv.expire(ipKey, 600);
  if (userCount === 1) await kv.expire(userKey, 600);
  return ipCount <= 20 && userCount <= 10;
}

export default async function handler(req, res) {
  const id = requestId();
  setApiSecurityHeaders(res);
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
    }

    const normalizedUsername = String(username).toLowerCase().trim();
    const rateOk = await assertLoginRateLimit(req, normalizedUsername);
    if (!rateOk) {
      return res.status(429).json({ error: 'Zu viele Login-Versuche. Bitte in einigen Minuten erneut versuchen.' });
    }

    const user = await kv.get(`user:${normalizedUsername}`);
    if (!user) return res.status(401).json({ error: 'Falsche Zugangsdaten' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Falsche Zugangsdaten' });

    const token = signToken(user);
    setAuthCookie(res, token);
    return res.json({
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
    return serverError(res, id, 'Login derzeit nicht moeglich. Bitte Konfiguration und Vercel-Logs pruefen.');
  }
}
