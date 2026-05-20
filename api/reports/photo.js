import { kv, requireAuth } from '../_lib/auth.js';
import { logApiError, methodNotAllowed, requestId, serverError, setApiSecurityHeaders } from '../_lib/http.js';
import { canAccessReport } from '../_lib/security.js';

export default async function handler(req, res) {
  const id = requestId();
  setApiSecurityHeaders(res);
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const reportId = req.query?.id;
    if (!reportId || typeof reportId !== 'string' || !/^rep_[a-zA-Z0-9_-]+$/.test(reportId)) {
      return res.status(400).json({ error: 'id fehlt oder ist ungueltig' });
    }

    const reports = (await kv.get('data:reports')) || [];
    const report = reports.find(r => r.id === reportId);
    const data = {
      players: (await kv.get('data:players')) || [],
      coaches: (await kv.get('data:coaches')) || [],
    };
    if (!canAccessReport(user, report, data)) return res.status(404).json({ error: 'Kein Foto vorhanden' });

    const photo = await kv.get(`photo:${reportId}`);
    if (!photo) return res.status(404).json({ error: 'Kein Foto vorhanden' });
    return res.json({ photo });
  } catch (e) {
    logApiError(id, 'Foto-Abruf fehlgeschlagen', e, { reportId: req.query?.id });
    return serverError(res, id, 'Foto konnte nicht geladen werden.');
  }
}
