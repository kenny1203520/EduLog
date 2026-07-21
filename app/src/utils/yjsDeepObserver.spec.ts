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

    it('preserves the remote transaction source for applied updates', () => {
        const localDoc = new Y.Doc()
        const observer = vi.fn()
        const stop = observeXmlFragmentDeep(localDoc.getXmlFragment('content_xml'), observer)
        const remoteDoc = new Y.Doc()
        const remoteFragment = remoteDoc.getXmlFragment('content_xml')
        const paragraph = new Y.XmlElement('paragraph')
        const text = new Y.XmlText('remote update')

        paragraph.insert(0, [text])
        remoteFragment.insert(0, [paragraph])
        Y.applyUpdate(localDoc, Y.encodeStateAsUpdate(remoteDoc))

        expect(observer).toHaveBeenCalledTimes(1)
        expect(observer.mock.calls[0]?.[1].local).toBe(false)

        stop()
        localDoc.destroy()
        remoteDoc.destroy()
    })
})
