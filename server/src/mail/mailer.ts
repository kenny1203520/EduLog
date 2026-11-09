import nodemailer from 'nodemailer'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiConfig } from '../config/config.js'

export type MailMessage = { to: string[]; subject: string; text: string; html: string }

export interface Mailer {
  readonly enabled: boolean
  send(message: MailMessage): Promise<void>
}

type MailConfig = Pick<ApiConfig, 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASS' | 'SMTP_ADMIN_EMAIL' | 'SMTP_SENDER_NAME'>

/** The API's own mail, through the SMTP server GoTrue uses. No SMTP host = no mail. */
export function createMailer(config: MailConfig): Mailer {
  if (!config.SMTP_HOST || !config.SMTP_ADMIN_EMAIL) return { enabled: false, async send() {} }
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS ?? '' } : undefined,
    disableFileAccess: true,
    disableUrlAccess: true,
  })
  const from = config.SMTP_SENDER_NAME ? { name: config.SMTP_SENDER_NAME, address: config.SMTP_ADMIN_EMAIL } : config.SMTP_ADMIN_EMAIL
  return {
    enabled: true,
    async send(message) {
      if (!message.to.length) return
      // Recipients are hidden from each other.
      await transport.sendMail({ from, to: from, bcc: message.to, subject: message.subject, text: message.text, html: message.html })
    },
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

export function pendingAccountMessage(email: string, provider: string, reviewUrl: string): Omit<MailMessage, 'to'> {
  const safeEmail = escapeHtml(email)
  const safeProvider = escapeHtml(provider)
  const safeUrl = escapeHtml(reviewUrl)
  return {
    subject: 'EduLog：有新帳號等待核准 / New account waiting for approval',
    text: `有新帳號等待核准：${email}（${provider}）。\n請至 ${reviewUrl} 審核。\n\nA new account is waiting for approval: ${email} (${provider}).\nReview it at ${reviewUrl}`,
    html: `<p>有新帳號等待核准：<strong>${safeEmail}</strong>（${safeProvider}）。</p><p><a href="${safeUrl}">前往審核</a></p><hr><p lang="en">A new account is waiting for approval: <strong>${safeEmail}</strong> (${safeProvider}).</p><p lang="en"><a href="${safeUrl}">Review accounts</a></p>`,
  }
}

/**
 * Tell administrators about a pending account, once. Mail failures are logged
 * and never block the sign-in that triggered them.
 */
export async function notifyPendingAccount(
  adminClient: SupabaseClient, mailer: Mailer, webBaseUrl: string, userId: string,
  log?: { warn: (obj: object, msg: string) => void },
) {
  if (!mailer.enabled) return
  try {
    const marked = await adminClient.rpc('mark_pending_account_notified', { p_user_id: userId })
    if (marked.error || marked.data !== true) return
    const [account, approvers] = await Promise.all([
      adminClient.rpc('list_pending_accounts'),
      adminClient.rpc('list_account_approver_emails'),
    ])
    if (account.error || approvers.error) throw new Error('PENDING_NOTICE_LOOKUP_FAILED')
    const row = ((account.data ?? []) as Array<{ id: string; email: string | null; provider: string }>).find((item) => item.id === userId)
    const recipients = ((approvers.data ?? []) as Array<{ email: string | null }>).map((item) => item.email).filter((email): email is string => Boolean(email))
    if (!row || !recipients.length) return
    const reviewUrl = new URL('/dashboard/settings?tab=system&section=account_approval', webBaseUrl).toString()
    await mailer.send({ to: recipients, ...pendingAccountMessage(row.email ?? userId, row.provider, reviewUrl) })
  } catch (error) {
    log?.warn({ event: 'pending_account_notice_failed', reason: error instanceof Error ? error.message : 'unknown' }, 'pending_account_notice_failed')
  }
}
