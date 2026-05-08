import { kv } from '../_lib/auth.js';

const REASONS = ['verloren', 'verschlissen', 'flock_kaputt', 'beschaedigt'];

export default async function handler(req, res) {
  if (req.method === 'POST') {
    // Öffentlicher Endpunkt — keine Authentifizierung, dafür Rate-Limiting
    const { team, number, item, reasons, comment, name, photo } = req.body || {};

    if (!team || number === undefined || number === null || number === '') {
      return res.status(400).json({ error: 'Team und Rückennummer/Initialen sind Pflicht.' });
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
      // Max. 800 KB Base64 — bleibt sicher unter dem 1 MB Vercel-KV-Limit pro Eintrag
      if (photo.length > 800_000) {
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

    // Person identifizieren (Spieler ODER Trainer) und Material markieren
    let identifiedRole = null;
    let identifiedPersonId = null;
    let materialMarked = 0;

    const players = (await kv.get('data:players')) || [];
    const coaches = (await kv.get('data:coaches')) || [];

    // Spieler-Match: numerisch (parseInt für robusten Vergleich, falls "07" eingegeben wird)
    const numAsInt = parseInt(String(number).replace(/[^0-9]/g, ''), 10);
    const player = !isNaN(numAsInt)
      ? players.find(p => p.team === team && String(p.number) === String(numAsInt))
      : null;

    // Trainer-Match: alphabetisch, case-insensitive (Initialen)
    const numAsInitials = String(number).trim().toUpperCase();
    const coach = numAsInitials
      ? coaches.find(c => c.team === team && String(c.number || '').trim().toUpperCase() === numAsInitials)
      : null;

    if (player) {
      identifiedRole = 'player';
      identifiedPersonId = player.id;
    } else if (coach) {
      identifiedRole = 'coach';
      identifiedPersonId = coach.id;
    }

    if (identifiedPersonId) {
      const inventory = (await kv.get('data:inventory')) || [];
      const updatedInventory = inventory.map(i => {
        if (i.assignedTo === identifiedPersonId && i.itemType === item && i.status === 'ausgegeben') {
          materialMarked += 1;
          return {
            ...i,
            flagged: true,
            flagReasons: validReasons,
            flagComment: comment || '',
            flagReportId: reportId,
            flagAt: new Date().toISOString(),
          };
        }
        return i;
      });
      if (materialMarked > 0) {
        await kv.set('data:inventory', updatedInventory);
      }
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
      identifiedRole,
      identifiedPersonId,
      materialMarked,
      createdAt: new Date().toISOString(),
      status: identifiedPersonId ? 'gesehen' : 'offen',
      handledBy: null,
      handledAt: null,
      orderId: null,
    };

    const all = (await kv.get('data:reports')) || [];
    all.push(report);
    await kv.set('data:reports', all);

    return res.json({ ok: true, id: report.id, identified: !!identifiedPersonId, materialMarked });
  }

  res.status(405).end();
}
