import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { observeXmlFragmentDeep } from './yjsDeepObserver'

describe('observeXmlFragmentDeep', () => {
    it('observes nested XmlText changes and can unsubscribe', () => {
        const doc = new Y.Doc()
        const fragment = doc.getXmlFragment('classNotes_xml')
        const paragraph = new Y.XmlElement('paragraph')
        const text = new Y.XmlText()

        paragraph.insert(0, [text])
        fragment.insert(0, [paragraph])

        const observer = vi.fn()
        const stop = observeXmlFragmentDeep(fragment, observer)

        text.insert(0, 'nested update')

        expect(observer).toHaveBeenCalledTimes(1)
        expect(observer.mock.calls[0]?.[1].local).toBe(true)
        expect(text.toString()).toBe('nested update')

        stop()
        text.insert(text.length, ' ignored')

        expect(observer).toHaveBeenCalledTimes(1)
        doc.destroy()
    })
})
