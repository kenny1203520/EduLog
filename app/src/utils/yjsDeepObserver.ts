import type * as Y from 'yjs'

export type XmlFragmentDeepObserver = Parameters<Y.XmlFragment['observeDeep']>[0]

export function observeXmlFragmentDeep(
    fragment: Y.XmlFragment,
    observer: XmlFragmentDeepObserver
): () => void {
    fragment.observeDeep(observer)

    return () => {
        fragment.unobserveDeep(observer)
    }
}
