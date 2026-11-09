/** Display names for GoTrue OAuth providers; unknown ones are title-cased. */
const LABELS: Record<string, string> = {
    apple: 'Apple',
    azure: 'Microsoft',
    bitbucket: 'Bitbucket',
    discord: 'Discord',
    facebook: 'Facebook',
    figma: 'Figma',
    fly: 'Fly.io',
    github: 'GitHub',
    gitlab: 'GitLab',
    google: 'Google',
    kakao: 'Kakao',
    keycloak: 'Keycloak',
    linkedin_oidc: 'LinkedIn',
    notion: 'Notion',
    slack_oidc: 'Slack',
    spotify: 'Spotify',
    twitch: 'Twitch',
    twitter: 'X',
    workos: 'WorkOS',
    zoom: 'Zoom',
}

export function providerLabel(provider: string): string {
    return LABELS[provider] ?? provider.replace(/_oidc$/, '').split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}
