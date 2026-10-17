type NavigatorLike = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>

// iPadOS reports a desktop Mac user agent, so a touch-capable "MacIntel" is an iPad.
export function isIosDevice(nav: NavigatorLike) {
    return /iP(hone|od|ad)/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
}

/**
 * iOS Safari zooms in when an input under 16px gains focus and never zooms back
 * out. maximum-scale=1 stops that automatic zoom while iOS still honours pinch
 * zoom (it ignores scale limits for user gestures), so it is applied on iOS
 * only: elsewhere the same setting would block pinch zoom.
 */
export function preventIosInputZoom(doc: Pick<Document, 'querySelector'>, nav: NavigatorLike) {
    if (!isIosDevice(nav)) return false
    const meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    if (!meta) return false
    const settings = meta.content.split(',').map(part => part.trim())
        .filter(part => part && !/^maximum-scale\s*=/i.test(part))
    meta.content = [...settings, 'maximum-scale=1'].join(', ')
    return true
}
