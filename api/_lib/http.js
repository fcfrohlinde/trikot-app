export function requestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function logApiError(id, message, error, extra = {}) {
  const safeExtra = { ...extra };
  delete safeExtra.password;
  delete safeExtra.token;
  delete safeExtra.authorization;
  console.error(`[${id}] ${message}`, {
    ...safeExtra,
    error: error?.message || String(error),
    stack: process.env.NODE_ENV === 'production' ? undefined : error?.stack,
  });
}

export function setApiSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return first?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
}

export function safeLogValue(value, max = 80) {
  return String(value || '').replace(/[^a-zA-Z0-9._@-]/g, '').slice(0, max);
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  return res.status(405).json({ error: `Methode nicht erlaubt. Erlaubt: ${allowed.join(', ')}` });
}

export function serverError(res, id, message = 'Serverfehler. Bitte Vercel-Logs mit dieser Fehler-ID prüfen.') {
  return res.status(500).json({ error: message, requestId: id });
}
