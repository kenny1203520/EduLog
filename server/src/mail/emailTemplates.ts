/**
 * GoTrue email templates (Traditional Chinese and English). GoTrue fetches
 * these HTML templates from the API over the private Docker network and
 * renders the Go-template placeholders before sending.
 *
 * All authentication links are same-origin EduLog API links. The API consumes
 * the one-time token and creates the session in an HttpOnly cookie.
 */

export type EmailTemplateName = 'invite' | 'recovery' | 'email_change' | 'confirmation'

const confirmLink = (type: string) =>
  '{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&amp;type=' + type

function layout(
  title: string,
  preheader: string,
  headingZh: string,
  bodyZh: string,
  headingEn: string,
  bodyEn: string,
  actionZh: string,
  actionEn: string,
  safetyZh: string,
  safetyEn: string,
  href: string,
): string {
  const textHref = href.replace(/&amp;/g, '&')
  const button =
    '<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:28px 0 24px">' +
    '<tr><td align="center" bgcolor="#087f66" style="border-radius:8px">' +
    '<a href="' + href + '" style="display:inline-block;border:1px solid #087f66;border-radius:8px;padding:14px 22px;color:#ffffff;font-family:Arial,\'Noto Sans TC\',sans-serif;font-size:16px;font-weight:700;line-height:1.3;text-decoration:none">' +
    '<span lang="zh-Hant">' + actionZh + '</span><span aria-hidden="true"> / </span><span lang="en">' + actionEn + '</span>' +
    '</a></td></tr></table>'

  return [
    '<!doctype html>',
    '<html lang="zh-Hant">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>' + title + '</title></head>',
    '<body style="margin:0;padding:0;background-color:#f3f6f5;color:#17211f;font-family:Arial,\'Noto Sans TC\',sans-serif;-webkit-text-size-adjust:100%">',
    '<div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;max-height:0;max-width:0;overflow:hidden;mso-hide:all">' + preheader + '</div>',
    '<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f3f6f5" style="width:100%;background-color:#f3f6f5">',
    '<tr><td align="center" style="padding:28px 16px">',
    '<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">',
    '<tr><td bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #dce5e2;border-radius:12px;padding:32px 28px">',
    '<p style="margin:0 0 24px;color:#087f66;font-size:18px;font-weight:700;line-height:1.4">EduLog</p>',
    '<h1 lang="zh-Hant" style="margin:0 0 12px;color:#17211f;font-size:24px;font-weight:700;line-height:1.35">' + headingZh + '</h1>',
    '<p lang="zh-Hant" style="margin:0;color:#33413e;font-size:16px;line-height:1.7">' + bodyZh + '</p>',
    '<h2 lang="en" style="margin:26px 0 10px;color:#17211f;font-size:20px;font-weight:700;line-height:1.4">' + headingEn + '</h2>',
    '<p lang="en" style="margin:0;color:#33413e;font-size:16px;line-height:1.7">' + bodyEn + '</p>',
    button,
    '<p lang="zh-Hant" style="margin:0 0 8px;color:#475550;font-size:14px;line-height:1.65">' + safetyZh + '</p>',
    '<p lang="en" style="margin:0;color:#475550;font-size:14px;line-height:1.65">' + safetyEn + '</p>',
    '<hr style="height:0;border:0;border-top:1px solid #dce5e2;margin:24px 0 18px">',
    '<p lang="zh-Hant" style="margin:0 0 8px;color:#475550;font-size:13px;line-height:1.6">如果按鈕無法使用，請複製以下網址並貼到瀏覽器：</p>',
    '<p lang="en" style="margin:0 0 8px;color:#475550;font-size:13px;line-height:1.6">If the button does not work, copy this URL into your browser:</p>',
    '<p style="margin:0;color:#33413e;font-size:13px;line-height:1.6;overflow-wrap:anywhere;word-break:break-word">' + textHref + '</p>',
    '</td></tr>',
    '<tr><td align="center" style="padding:18px 12px;color:#52615d;font-size:12px;line-height:1.6">',
    '<span lang="zh-Hant">此郵件由 EduLog 自動寄出，請勿直接回覆。</span><br>',
    '<span lang="en">This message was sent automatically by EduLog. Please do not reply.</span>',
    '</td></tr>',
    '</table></td></tr></table>',
    '</body></html>',
  ].join('')
}

export const EMAIL_TEMPLATES: Record<EmailTemplateName, string> = {
  invite: layout(
    'EduLog 帳號邀請 / Your EduLog account invitation',
    '請設定密碼以啟用你的 EduLog 帳號 / Set a password to activate your EduLog account',
    '你已收到 EduLog 邀請',
    '管理員已為你建立 EduLog 帳號。請設定密碼以完成啟用；可用功能依帳號角色設定。',
    'You are invited to EduLog',
    'An administrator created an EduLog account for you. Set a password to activate it. Available features depend on the roles assigned to your account.',
    '設定密碼',
    'Set password',
    '如果你沒有預期收到這封邀請，請忽略本信或聯絡 EduLog 管理員。',
    'If you were not expecting this invitation, ignore this email or contact your EduLog administrator.',
    confirmLink('invite'),
  ),
  recovery: layout(
    '重設 EduLog 密碼 / Reset your EduLog password',
    '請依照步驟重設 EduLog 密碼 / Follow the steps to reset your EduLog password',
    '重設你的 EduLog 密碼',
    '我們收到這個 EduLog 帳號的密碼重設要求。按下方按鈕，依頁面指示設定新密碼。',
    'Reset your EduLog password',
    'We received a request to reset the password for your EduLog account. Use the button below to choose a new one.',
    '重設密碼',
    'Reset password',
    '如果你沒有提出要求，請忽略本信；你的密碼不會因此變更。EduLog 不會要求你透過 Email 傳送密碼。',
    'If you did not request this, ignore this email; your password will remain unchanged. EduLog will never ask you to send your password by email.',
    confirmLink('recovery'),
  ),
  email_change: layout(
    '確認 EduLog Email 變更 / Confirm your EduLog email change',
    '請確認變更 EduLog 登入 Email / Confirm the email address for your EduLog sign-in',
    '確認 EduLog Email 變更',
    '請確認將 EduLog 登入 Email 從 {{ .Email }} 變更為 {{ .NewEmail }}。確認後，新 Email 將用來登入。',
    'Confirm your EduLog email change',
    'Confirm changing your EduLog sign-in email from {{ .Email }} to {{ .NewEmail }}. After confirmation, the new email will be used to sign in.',
    '確認變更 Email',
    'Confirm email change',
    '如果你沒有提出這項變更，請忽略本信，不要按下確認按鈕。',
    'If you did not request this change, ignore this email and do not confirm it.',
    confirmLink('email_change'),
  ),
  confirmation: layout(
    '確認 EduLog Email / Confirm your EduLog email',
    '請確認此 Email 地址以完成 EduLog 註冊 / Confirm this email address to complete EduLog sign-up',
    '確認你的 EduLog Email',
    '請確認此 Email 地址以完成註冊。驗證後，管理員仍須核准帳號；核准前無法使用 EduLog。',
    'Confirm your EduLog email',
    'Confirm this email address to complete sign-up. An administrator must still approve your account before you can use EduLog.',
    '確認 Email',
    'Confirm email',
    '如果你沒有註冊 EduLog，請忽略本信。',
    'If you did not sign up for EduLog, ignore this email.',
    confirmLink('signup'),
  ),
}

export function isEmailTemplateName(name: string): name is EmailTemplateName {
  return Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATES, name)
}
