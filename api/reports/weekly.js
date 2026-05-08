import { kv, requireAuth } from '../_lib/auth.js';
import { sendMail, getSmtpConfig } from '../_lib/mailer.js';

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    // Wochenbericht-Daten zurückliefern (für die Anzeige in der App)
    const data = await loadReportData();
    const smtp = getSmtpConfig();
    return res.json({ ...data, smtpConfigured: smtp.configured });
  }

  if (req.method === 'POST') {
    const data = await loadReportData();
    const settings = (await kv.get('data:settings')) || {};
    const isTest = req.body?.test === true;

    if (!settings.weeklyReportEnabled) {
      return res.status(400).json({ error: 'Wochenbericht-Versand ist in den Einstellungen deaktiviert.' });
    }
    if (!settings.weeklyReportEmail) {
      return res.status(400).json({ error: 'Keine Empfänger-E-Mail in den Einstellungen hinterlegt.' });
    }

    const smtp = getSmtpConfig();
    if (!smtp.configured) {
      return res.status(500).json({
        error: 'SMTP nicht konfiguriert. Bitte SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM in Vercel-Umgebungsvariablen setzen.',
      });
    }

    const html = renderEmail(data, settings, isTest);
    const subjectPrefix = isTest ? '[TEST] ' : '';
    const subject = `${subjectPrefix}Trikot-Wochenbericht — ${new Date().toLocaleDateString('de-DE')} — ${data.openReports.length} offene Meldungen`;

    try {
      const result = await sendMail({
        to: settings.weeklyReportEmail.split(',').map(e => e.trim()).filter(Boolean),
        subject,
        html,
      });
      const sentAt = new Date().toISOString();
      if (!isTest) {
        await kv.set('meta:weeklyReportLastSent', sentAt);
      }
      return res.json({ ok: true, sentAt, messageId: result.messageId, accepted: result.accepted });
    } catch (e) {
      // Detailfehler durchreichen, damit der Nutzer im UI sieht, woran's liegt
      return res.status(500).json({ error: `SMTP-Fehler: ${e.message}` });
    }
  }

  res.status(405).end();
}

async function loadReportData() {
  const reports = (await kv.get('data:reports')) || [];
  const players = (await kv.get('data:players')) || [];
  const coaches = (await kv.get('data:coaches')) || [];
  const items = (await kv.get('data:items')) || [];
  const orders = (await kv.get('data:orders')) || [];

  // Personen-Suche: erst numerisch (Spieler), dann alphabetisch (Trainer-Initialen)
  function findPersonForReport(team, number) {
    const numStr = String(number);
    const player = players.find(p => p.team === team && String(p.number) === numStr);
    if (player) return player;
    const initials = numStr.trim().toUpperCase();
    return coaches.find(c => c.team === team && String(c.number || '').trim().toUpperCase() === initials);
  }

  const openReports = reports.filter(r => r.status === 'offen' || r.status === 'gesehen');
  const lastSent = await kv.get('meta:weeklyReportLastSent');

  // Aggregation nach Artikel + Team für Bestellempfehlung
  const aggregation = {};
  openReports.forEach(r => {
    const key = `${r.team}__${r.item}`;
    if (!aggregation[key]) {
      const item = items.find(i => i.id === r.item);
      aggregation[key] = {
        team: r.team,
        itemId: r.item,
        itemName: item?.name || r.item,
        count: 0,
        players: [],
      };
    }
    const person = findPersonForReport(r.team, r.number);
    aggregation[key].count += 1;
    aggregation[key].players.push({
      number: r.number,
      name: person ? `${person.firstName} ${person.lastName}` : '— unbekannt —',
      reasons: r.reasons,
      reportId: r.id,
    });
  });

  return {
    openReports,
    aggregation: Object.values(aggregation),
    lastSent,
  };
}

const REASON_LABELS = {
  verloren: 'verloren',
  verschlissen: 'verschlissen',
  flock_kaputt: 'Flock defekt',
  beschaedigt: 'beschädigt',
};

function renderEmail(data, settings, isTest = false) {
  const styles = `
    body { font-family: 'Source Sans 3', Arial, sans-serif; background:#F8F5F0; margin:0; padding:24px; color:#1A1A1A; }
    .wrap { max-width:640px; margin:0 auto; background:#fff; border:1px solid #DCD6C8; }
    .head { background:#0B2D5C; color:#fff; padding:24px; }
    .head h1 { margin:0 0 4px 0; font-family:Georgia,serif; font-size:28px; font-weight:700; }
    .head .label { font-size:11px; letter-spacing:0.18em; color:#C9A227; text-transform:uppercase; }
    .body { padding:24px; }
    table { width:100%; border-collapse:collapse; margin-top:8px; }
    th { text-align:left; font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:#0B2D5C; padding:8px; border-bottom:1px solid #DCD6C8; }
    td { padding:8px; font-size:14px; border-bottom:1px solid #EFEAE0; vertical-align:top; }
    .stat { display:inline-block; padding:8px 14px; background:#F1ECDF; margin-right:8px; }
    .stat b { font-family:Georgia,serif; font-size:24px; display:block; line-height:1; color:#0B2D5C; }
    .stat span { font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:#807D78; }
    .foot { padding:16px 24px; font-size:12px; color:#807D78; border-top:1px solid #DCD6C8; }
    .test-banner { background:#C9A227; color:#0B2D5C; padding:8px 24px; font-size:12px; font-weight:bold; letter-spacing:0.12em; text-transform:uppercase; }
  `;

  const aggregationRows = data.aggregation.map(a => `
    <tr>
      <td><strong>${a.itemName}</strong><br><span style="color:#807D78;font-size:12px">${a.team}</span></td>
      <td style="text-align:center;font-family:Georgia,serif;font-size:24px;color:#0B2D5C;">${a.count}</td>
      <td>${a.players.map(p => `Nr. ${p.number} ${p.name} <span style="color:#807D78">(${p.reasons.map(r => REASON_LABELS[r] || r).join(', ')})</span>`).join('<br>')}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${styles}</style></head>
  <body><div class="wrap">
    ${isTest ? '<div class="test-banner">⚙ TEST-VERSAND — Diese Mail dient nur zur Konfigurationsprüfung</div>' : ''}
    <div class="head">
      <div class="label">WOCHENBERICHT</div>
      <h1>Trikot-Bedarfsmeldungen</h1>
      <div style="color:#A8B8D0;font-size:13px;margin-top:4px;">${settings.clubName || ''} · ${new Date().toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</div>
    </div>
    <div class="body">
      <div style="margin-bottom:24px;">
        <div class="stat"><b>${data.openReports.length}</b><span>OFFENE MELDUNGEN</span></div>
        <div class="stat"><b>${data.aggregation.length}</b><span>BETROFFENE ARTIKEL</span></div>
      </div>
      ${data.aggregation.length === 0 ? '<p style="color:#807D78;">Keine offenen Bedarfsmeldungen in dieser Woche.</p>' : `
        <h2 style="font-family:Georgia,serif;font-size:18px;margin:0 0 12px 0;">Bestellempfehlung</h2>
        <table>
          <tr><th>Artikel / Mannschaft</th><th style="text-align:center;">Anz.</th><th>Spieler & Gründe</th></tr>
          ${aggregationRows}
        </table>
      `}
    </div>
    <div class="foot">
      Dieser Bericht wurde automatisch aus der Trikotverwaltung erzeugt. Anpassungen am Versand sind in den Einstellungen möglich.
    </div>
  </div></body></html>`;
}
