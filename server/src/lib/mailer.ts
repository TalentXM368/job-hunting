// Send the digest over SMTP. Gmail: use an App Password, not the login password.

import nodemailer from 'nodemailer'

export interface MailConfig {
  host: string
  port: number
  user: string
  pass: string
  to: string
}

/** Null when SMTP is not configured, so callers can report it instead of failing. */
export function mailConfig(): MailConfig | null {
  const user = (process.env.SMTP_USER ?? '').trim()
  const pass = (process.env.SMTP_PASS ?? '').trim()
  if (!user || !pass) return null
  return {
    host: (process.env.SMTP_HOST ?? '').trim() || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    user,
    pass,
    to: (process.env.MAIL_TO ?? '').trim() || user,
  }
}

export async function sendMail(cfg: MailConfig, subject: string, html: string): Promise<void> {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465, // 587 upgrades with STARTTLS
    auth: { user: cfg.user, pass: cfg.pass },
  })
  await transport.sendMail({
    from: cfg.user,
    to: cfg.to,
    subject,
    text: 'This digest is HTML. Open it in an HTML-capable client.',
    html,
  })
}
