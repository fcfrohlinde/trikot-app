import { kv } from '@vercel/kv';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

function getJwtSecret() {
  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET fehlt oder ist zu kurz. Bitte in Vercel als Environment Variable mit mindestens 32 Zeichen setzen.');
  }
  return JWT_SECRET;
}

export function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name || user.username,
      teams: Array.isArray(user.teams) ? user.teams : [],
    },
    getJwtSecret(),
    { expiresIn: '30d' }
  );
}

export function verifyToken(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer /, '');
  if (!token) return null;
  try {
    return jwt.verify(token, getJwtSecret());
  } catch {
    return null;
  }
}

export async function requireAuth(req, res) {
  const tokenUser = verifyToken(req);
  if (!tokenUser) {
    res.status(401).json({ error: 'Nicht angemeldet' });
    return null;
  }
  // Aktuellen Stand aus KV laden — damit nachträgliche Team-, Rollen- oder
  // Berechtigungs-Änderungen sofort wirken statt erst nach Token-Ablauf.
  const fresh = await kv.get(`user:${tokenUser.username}`);
  if (!fresh) {
    res.status(401).json({ error: 'Account existiert nicht mehr' });
    return null;
  }
  return {
    id: fresh.id,
    username: fresh.username,
    name: fresh.name,
    role: fresh.role,
    teams: Array.isArray(fresh.teams) ? fresh.teams : [],
    permissions: fresh.permissions || null,
  };
}

export async function requireAdmin(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Keine Berechtigung' });
    return null;
  }
  return user;
}

export { kv };
