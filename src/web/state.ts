import { withUpdatedAt, type I18nBundle } from '@wads.dev/i18n-ts/bundle'

type StateChange = { reason: 'edit' | 'replace' }
type StateListener = (bundle: I18nBundle | null, change: StateChange) => void

export function createEditorState() {
  let bundle: I18nBundle | null = null
  const listeners = new Set<StateListener>()

  function notify(reason: StateChange['reason']): void {
    listeners.forEach((listener) => listener(bundle, { reason }))
  }

  return {
    getBundle: (): I18nBundle | null => bundle,
    replaceBundle(nextBundle: I18nBundle): void {
      bundle = nextBundle
      notify('replace')
    },
    update(updater: (current: I18nBundle) => I18nBundle): void {
      if (!bundle) throw new Error('There is no loaded bundle to edit.')
      bundle = withUpdatedAt(updater(bundle))
      notify('edit')
    },
    subscribe(listener: StateListener): () => boolean {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
