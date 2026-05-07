import nodemailer from 'nodemailer';

// Liest SMTP-Konfiguration aus Umgebungsvariablen
// SMTP_HOST=smtp.example.com
// SMTP_PORT=587
// SMTP_SECURE=false  (true für Port 465, false für Port 587 mit STARTTLS)
// SMTP_USER=user@example.com
// SMTP_PASS=password
// SMTP_FROM="FC Frohlinde Trikotverwaltung <noreply@fc-frohlinde.de>"
export function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const secure = (process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  if (!host || !user || !pass) {
    return { configured: false };
  }
  return { configured: true, host, port, secure, user, pass, from };
}

export function createTransporter() {
  const cfg = getSmtpConfig();
  if (!cfg.configured) return null;
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
}

export async function sendMail({ to, subject, html, text }) {
  const cfg = getSmtpConfig();
  if (!cfg.configured) {
    throw new Error('SMTP nicht konfiguriert. Bitte SMTP_HOST, SMTP_USER und SMTP_PASS in Vercel-Umgebungsvariablen setzen.');
  }
  const transporter = createTransporter();
  // Verbindung kurz testen — schlägt sofort an, wenn z. B. Passwort falsch ist
  await transporter.verify();
  const info = await transporter.sendMail({
    from: cfg.from,
    to,
    subject,
    html,
    text,
  });
  return { messageId: info.messageId, accepted: info.accepted };
}
