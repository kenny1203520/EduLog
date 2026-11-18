import type { ApiConfig } from '../config/config.js'
import { discoverAuthProviders, hasSamlProvider } from './gotrue.js'

export async function authCapabilities(config: ApiConfig) {
  const { settings, custom, providers } = await discoverAuthProviders(config)
  const saml = settings?.saml_enabled === true ? await hasSamlProvider(config).catch(() => undefined) : false
  const sms = Boolean(settings?.sms_provider)
  const email = settings?.external.email === true && config.AUTH_MAIL_DELIVERY_ENABLED

  return {
    providers,
    providerLabels: custom?.labels ?? {},
    outboundOAuth: config.AUTH_OUTBOUND_OAUTH_ENABLED,
    methods: {
      password: settings?.external.email !== false,
      emailOtp: email && config.AUTH_EMAIL_OTP_ENABLED,
      magicLink: email && config.AUTH_MAGIC_LINK_ENABLED,
      sms: settings?.external.phone === true && sms,
      saml: saml === true,
      passkeys: settings?.passkeys_enabled === true,
    },
    mfa: {
      totp: config.AUTH_MFA_TOTP_ENROLL_ENABLED && config.AUTH_MFA_TOTP_VERIFY_ENABLED,
      phone: sms && config.AUTH_MFA_PHONE_ENROLL_ENABLED && config.AUTH_MFA_PHONE_VERIFY_ENABLED,
      webauthn: config.AUTH_MFA_WEBAUTHN_ENROLL_ENABLED && config.AUTH_MFA_WEBAUTHN_VERIFY_ENABLED,
      recoveryCodes: config.AUTH_MFA_RECOVERY_CODES_ENABLED,
    },
    unavailable: [
      ...(!settings ? ['settings'] : []),
      ...(!custom ? ['customProviders'] : []),
      ...(saml === undefined ? ['samlProviders'] : []),
    ],
  }
}
