/**
 * GoTrue email templates (Traditional Chinese, then English). GoTrue fetches
 * them over the internal network from GET /email-templates/<name>.html (see
 * GOTRUE_MAILER_TEMPLATES_* in docker-compose.yml) and fills in the
 * {{ .Variable }} placeholders itself.
 *
 * Every link goes to the API's /api/auth/confirm with a token hash, so the
 * session is created on the server and stored in httpOnly cookies; no token
 * ever appears in a browser URL fragment.
 */

export type EmailTemplateName = 'invite' | 'recovery' | 'email_change' | 'confirmation'

const confirmLink = (type: string) => `{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${type}`

function layout(title: string, zh: string, en: string, buttonZh: string, buttonEn: string, href: string) {
  const button = (label: string) => `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#059669;color:#ffffff;font-weight:700;text-decoration:none">${label}</a></p>`
  return `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:24px;background:#f9fafb;font-family:system-ui,-apple-system,'Segoe UI','Noto Sans TC',sans-serif;color:#111827">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:28px">
<h1 style="margin:0 0 16px;font-size:20px;color:#047857">EduLog</h1>
${zh}
${button(buttonZh)}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
<div lang="en">
${en}
${button(buttonEn)}
</div>
<p style="margin-top:24px;font-size:12px;color:#6b7280">若按鈕無法使用，請複製此連結到瀏覽器：<br>If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${href}</span></p>
</div>
</body>
</html>
`
}

export const EMAIL_TEMPLATES: Record<EmailTemplateName, string> = {
  invite: layout(
    'EduLog 邀請 / Invitation',
    '<p>您好，您已受邀使用 EduLog 家教報告系統。請點擊下方按鈕設定密碼並啟用帳號。</p>',
    '<p>Hello, you have been invited to EduLog. Use the button below to set your password and activate your account.</p>',
    '設定密碼', 'Set password', confirmLink('invite'),
  ),
  recovery: layout(
    'EduLog 重設密碼 / Reset password',
    '<p>我們收到重設 {{ .Email }} 密碼的要求。請點擊下方按鈕設定新密碼；若不是您本人提出，請忽略此信。</p>',
    '<p>We received a request to reset the password for {{ .Email }}. Use the button below to choose a new one. If you did not ask for this, ignore this email.</p>',
    '重設密碼', 'Reset password', confirmLink('recovery'),
  ),
  email_change: layout(
    'EduLog 確認新 Email / Confirm new email',
    '<p>請確認將 EduLog 帳號的 Email 由 {{ .Email }} 變更為 {{ .NewEmail }}。</p>',
    '<p>Please confirm changing your EduLog email from {{ .Email }} to {{ .NewEmail }}.</p>',
    '確認變更', 'Confirm change', confirmLink('email_change'),
  ),
  confirmation: layout(
    'EduLog 確認 Email / Confirm email',
    '<p>請確認 {{ .Email }} 是您的 Email。確認後，帳號仍需管理員核准才能使用。</p>',
    '<p>Please confirm that {{ .Email }} is your email. After confirming, an administrator still needs to approve the account.</p>',
    '確認 Email', 'Confirm email', confirmLink('signup'),
  ),
}

export function isEmailTemplateName(name: string): name is EmailTemplateName {
  return Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATES, name)
}
