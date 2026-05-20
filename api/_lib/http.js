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

export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  return res.status(405).json({ error: `Methode nicht erlaubt. Erlaubt: ${allowed.join(', ')}` });
}

export function serverError(res, id, message = 'Serverfehler. Bitte Vercel-Logs mit dieser Fehler-ID prüfen.') {
  return res.status(500).json({ error: message, requestId: id });
}
