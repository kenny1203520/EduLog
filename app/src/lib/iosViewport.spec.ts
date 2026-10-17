import { beforeEach, describe, expect, it } from 'vitest'
import { isIosDevice, preventIosInputZoom } from './iosViewport'

const BASE = 'width=device-width, initial-scale=1.0, viewport-fit=cover'
const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 }
const ipadDesktopMode = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 }
const mac = { ...ipadDesktopMode, maxTouchPoints: 0 }
const android = { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36', platform: 'Linux armv8l', maxTouchPoints: 5 }

function viewport() {
    return document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!
}

describe('preventIosInputZoom', () => {
    beforeEach(() => {
        document.head.innerHTML = `<meta name="viewport" content="${BASE}">`
    })

    it('detects iPhone and iPadOS in desktop mode but not a Mac or Android', () => {
        expect(isIosDevice(iphone)).toBe(true)
        expect(isIosDevice(ipadDesktopMode)).toBe(true)
        expect(isIosDevice(mac)).toBe(false)
        expect(isIosDevice(android)).toBe(false)
    })

    it('adds maximum-scale=1 on iOS while keeping the existing viewport settings', () => {
        expect(preventIosInputZoom(document, iphone)).toBe(true)
        expect(viewport().content).toBe(`${BASE}, maximum-scale=1`)

        preventIosInputZoom(document, ipadDesktopMode)
        expect(viewport().content).toBe(`${BASE}, maximum-scale=1`)
    })

    it('leaves the viewport alone elsewhere so pinch zoom is never blocked', () => {
        expect(preventIosInputZoom(document, android)).toBe(false)
        expect(preventIosInputZoom(document, mac)).toBe(false)
        expect(viewport().content).toBe(BASE)
    })

    it('does nothing without a viewport meta tag', () => {
        document.head.innerHTML = ''
        expect(preventIosInputZoom(document, iphone)).toBe(false)
    })
})
