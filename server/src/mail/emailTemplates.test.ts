import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EMAIL_TEMPLATES, isEmailTemplateName } from './emailTemplates.js'

describe('GoTrue email templates', () => {
  it('provides the four configured transactional flows', () => {
    expect(Object.keys(EMAIL_TEMPLATES).sort()).toEqual(['confirmation', 'email_change', 'invite', 'recovery'])
    expect(isEmailTemplateName('recovery')).toBe(true)
    expect(isEmailTemplateName('magic_link')).toBe(false)
  })

  it.each(Object.entries(EMAIL_TEMPLATES))('%s is a bilingual, single-action email with a copyable fallback URL', (_name, html) => {
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('lang="zh-Hant"')
    expect(html).toContain('lang="en"')
    expect(html).toContain('role="presentation"')
    expect(html.match(/<a\b/g) ?? []).toHaveLength(1)
    expect(html).toContain('If the button does not work, copy this URL into your browser:')
    expect(html).toContain('{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&amp;type=')
    expect(html).toContain('{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=')
    expect(html).not.toContain('{{ .ConfirmationURL }}')
    expect(html).not.toMatch(/<img\b|<link\b|https?:\/\/[^"' ]+\.(?:png|jpe?g|gif|woff2?)/i)
  })

  it('keeps the recovery message direct and non-promotional', () => {
    expect(EMAIL_TEMPLATES.recovery).toContain('We received a request to reset the password for your EduLog account.')
    expect(EMAIL_TEMPLATES.recovery).toContain('your password will remain unchanged')
    expect(EMAIL_TEMPLATES.recovery).toContain('重設你的 EduLog 密碼')
    expect(EMAIL_TEMPLATES.recovery).not.toContain('{{ .Email }}')
  })

  it('keeps email-change placeholders in the Go HTML template for escaping', () => {
    expect(EMAIL_TEMPLATES.email_change).toContain('{{ .Email }}')
    expect(EMAIL_TEMPLATES.email_change).toContain('{{ .NewEmail }}')
  })

  it('wires each Auth template, subject, and sender name in Compose', () => {
    const compose = readFileSync(new URL('../../../docker-compose.yml', import.meta.url), 'utf8')
    for (const flow of ['INVITE', 'RECOVERY', 'EMAIL_CHANGE', 'CONFIRMATION']) {
      expect(compose).toContain('GOTRUE_MAILER_TEMPLATES_' + flow)
      expect(compose).toContain('GOTRUE_MAILER_SUBJECTS_' + flow)
    }
    expect(compose).toContain('GOTRUE_SMTP_SENDER_NAME: ${SMTP_SENDER_NAME:-EduLog}')
    expect(compose).toContain('SMTP_SENDER_NAME: ${SMTP_SENDER_NAME:-EduLog}')
    expect(compose).toContain('http://api:3000/email-templates')
    expect(compose).toContain('GOTRUE_MAILER_SUBJECTS_INVITE: "EduLog 帳號邀請 / Your EduLog account invitation"')
    expect(compose).toContain('GOTRUE_MAILER_SUBJECTS_RECOVERY: "重設 EduLog 密碼 / Reset your EduLog password"')
    expect(compose).toContain('GOTRUE_MAILER_SUBJECTS_EMAIL_CHANGE: "確認 EduLog Email 變更 / Confirm your EduLog email change"')
    expect(compose).toContain('GOTRUE_MAILER_SUBJECTS_CONFIRMATION: "確認 EduLog Email / Confirm your EduLog email"')
  })
})
