import { kv } from '../_lib/auth.js';

const REASONS = ['verloren', 'verschlissen', 'flock_kaputt', 'beschaedigt'];

export default async function handler(req, res) {
  if (req.method === 'POST') {
    // Öffentlicher Endpunkt — keine Authentifizierung, dafür Rate-Limiting
    const { team, number, item, reasons, comment, name, photo } = req.body || {};

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

    // Foto-Validierung
    let photoData = null;
    if (photo) {
      if (typeof photo !== 'string' || !photo.startsWith('data:image/')) {
        return res.status(400).json({ error: 'Ungültiges Bildformat.' });
      }
      // Max. 1.5 MB Base64 (≈ 1.1 MB Binär)
      if (photo.length > 1_500_000) {
        return res.status(400).json({ error: 'Bild zu groß. Bitte erneut auswählen oder kleineres Bild nutzen.' });
      }
      photoData = photo;
    }

    // Einfaches Rate-Limit pro IP: max 10 Meldungen / 10 Minuten
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    const rateKey = `rate:report:${ip}`;
    const count = await kv.incr(rateKey);
    if (count === 1) await kv.expire(rateKey, 600);
    if (count > 10) {
      return res.status(429).json({ error: 'Zu viele Meldungen in kurzer Zeit. Bitte später erneut versuchen.' });
    }

    const reportId = `rep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Foto separat speichern mit Auto-Löschung nach 90 Tagen (DSGVO-konform & Speicher schonend)
    if (photoData) {
      await kv.set(`photo:${reportId}`, photoData, { ex: 60 * 60 * 24 * 90 });
    }

    const report = {
      id: reportId,
      team,
      number: parseInt(number),
      item,
      reasons: validReasons,
      comment: comment || '',
      reporterName: name || '',
      hasPhoto: !!photoData,
      createdAt: new Date().toISOString(),
      status: 'offen',
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
