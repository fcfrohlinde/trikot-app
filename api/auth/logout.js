import { clearAuthCookie } from '../_lib/auth.js';
import { methodNotAllowed, setApiSecurityHeaders } from '../_lib/http.js';

export default async function handler(req, res) {
  setApiSecurityHeaders(res);
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  clearAuthCookie(res);
  return res.json({ ok: true });
}
