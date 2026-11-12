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
  const senderName = config.SMTP_SENDER_NAME?.trim() || 'EduLog'
  const from = { name: senderName, address: config.SMTP_ADMIN_EMAIL }
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
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return value.replace(/[&<>"']/g, (char) => entities[char]!)
}

/** Names of the sign-in methods as people know them; GoTrue reports ids such as azure. */
const PROVIDER_LABELS: Record<string, string> = {
  email: 'Email', apple: 'Apple', azure: 'Microsoft', github: 'GitHub', gitlab: 'GitLab', google: 'Google',
  keycloak: 'Keycloak', linkedin_oidc: 'LinkedIn', slack_oidc: 'Slack', twitter: 'X', workos: 'WorkOS',
}

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider]
    ?? provider.replace(/_oidc$/, '').split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

export function pendingAccountMessage(email: string, providerId: string, reviewUrl: string): Omit<MailMessage, 'to'> {
  const provider = providerLabel(providerId)
  const safeEmail = escapeHtml(email)
  const safeProvider = escapeHtml(provider)
  const safeUrl = escapeHtml(reviewUrl)
  const text = [
    '新帳號等待管理員審核。',
    '登入方式：' + provider,
    '申請 Email：' + email,
    '請由 EduLog 管理後台的「帳號審核」頁面處理：',
    reviewUrl,
    '',
    'A new account is waiting for administrator approval.',
    'Sign-in method: ' + provider,
    'Account email: ' + email,
    'Review it from the EduLog administration area:',
    reviewUrl,
  ].join('\n')
  const html = [
    '<!doctype html>',
    '<html lang="zh-Hant">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EduLog 帳號待審核 / Account awaiting review</title></head>',
    '<body style="margin:0;padding:0;background-color:#f3f6f5;color:#17211f;font-family:Arial,sans-serif">',
    '<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f3f6f5" style="width:100%;background-color:#f3f6f5"><tr><td align="center" style="padding:24px 16px">',
    '<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px"><tr><td bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #dce5e2;border-radius:12px;padding:28px">',
    '<p style="margin:0 0 20px;color:#087f66;font-size:18px;font-weight:700">EduLog</p>',
    '<h1 lang="zh-Hant" style="margin:0 0 10px;color:#17211f;font-size:22px;line-height:1.35">新帳號等待審核</h1>',
    '<p lang="zh-Hant" style="margin:0;color:#33413e;font-size:15px;line-height:1.65">有一個新帳號等待管理員審核。</p>',
    '<p lang="zh-Hant" style="margin:14px 0 0;color:#33413e;font-size:15px;line-height:1.65">申請 Email：<strong>' + safeEmail + '</strong><br>登入方式：' + safeProvider + '</p>',
    '<h2 lang="en" style="margin:24px 0 10px;color:#17211f;font-size:19px;line-height:1.4">A new account is awaiting review</h2>',
    '<p lang="en" style="margin:0;color:#33413e;font-size:15px;line-height:1.65">Review this account from the EduLog administration area.</p>',
    '<p lang="en" style="margin:14px 0 0;color:#33413e;font-size:15px;line-height:1.65">Account email: <strong>' + safeEmail + '</strong><br>Sign-in method: ' + safeProvider + '</p>',
    '<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td align="center" bgcolor="#087f66" style="border-radius:8px"><a href="' + safeUrl + '" style="display:inline-block;border:1px solid #087f66;border-radius:8px;padding:13px 20px;color:#ffffff;font-size:15px;font-weight:700;line-height:1.3;text-decoration:none"><span lang="zh-Hant">前往帳號審核</span> / <span lang="en">Review account</span></a></td></tr></table>',
    '<p style="margin:0;color:#52615d;font-size:12px;line-height:1.6"><span lang="zh-Hant">此郵件由 EduLog 自動寄出，請勿直接回覆。</span><br><span lang="en">This message was sent automatically by EduLog. Please do not reply.</span></p>',
    '</td></tr></table></td></tr></table>',
    '</body></html>',
  ].join('')
  return {
    subject: 'EduLog 帳號待審核 / New EduLog account awaiting review',
    text,
    html,
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
