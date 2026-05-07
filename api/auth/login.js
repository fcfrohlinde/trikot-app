import bcrypt from 'bcryptjs';
import { kv, signToken } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  }

  const user = await kv.get(`user:${username.toLowerCase()}`);
  if (!user) {
    return res.status(401).json({ error: 'Falsche Zugangsdaten' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Falsche Zugangsdaten' });
  }

  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role, name: user.name },
  });
}
