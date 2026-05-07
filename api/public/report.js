import { kv } from '../_lib/auth.js';

const REASONS = ['verloren', 'verschlissen', 'flock_kaputt', 'beschaedigt'];

export default async function handler(req, res) {
  if (req.method === 'POST') {
    // Öffentlicher Endpunkt — keine Authentifizierung, dafür Rate-Limiting
    const { team, number, item, reasons, comment, name } = req.body || {};

    if (!team || number === undefined || number === null || number === '') {
      return res.status(400).json({ error: 'Team und Rückennummer sind Pflicht.' });
    }
    if (!item) {
      return res.status(400).json({ error: 'Artikel fehlt.' });
    }
    const validReasons = (reasons || []).filter(r => REASONS.includes(r));
    if (validReasons.length === 0) {
      return res.status(400).json({ error: 'Mindestens ein Grund muss angegeben werden.' });
    }

    // Einfaches Rate-Limit pro IP: max 10 Meldungen / 10 Minuten
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    const rateKey = `rate:report:${ip}`;
    const count = await kv.incr(rateKey);
    if (count === 1) await kv.expire(rateKey, 600);
    if (count > 10) {
      return res.status(429).json({ error: 'Zu viele Meldungen in kurzer Zeit. Bitte später erneut versuchen.' });
    }

    const report = {
      id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      team,
      number: parseInt(number),
      item,
      reasons: validReasons,
      comment: comment || '',
      reporterName: name || '',
      createdAt: new Date().toISOString(),
      status: 'offen', // offen | gesehen | bestellt | erledigt
      handledBy: null,
      handledAt: null,
      orderId: null,
    };

    const all = (await kv.get('data:reports')) || [];
    all.push(report);
    await kv.set('data:reports', all);

    return res.json({ ok: true, id: report.id });
  }

  res.status(405).end();
}
