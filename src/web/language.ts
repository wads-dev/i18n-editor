import { loadLanguage, type DeepReadonly } from '@wads.dev/i18n-ts'

import type { EditorTranslation } from './i18n/base.js'
import { Langs, type EditorLanguage } from './i18n/index.js'
import en from './i18n/en.js'

export type { EditorLanguage } from './i18n/index.js'

declare global {
  var Lang: DeepReadonly<EditorTranslation>
  var CurrentLanguage: EditorLanguage
}

const LANGUAGE_STORAGE_KEY = '@wads.dev/i18n-editor/language'

globalThis.Lang = en
globalThis.CurrentLanguage = 'en'

export async function setLanguage(language?: EditorLanguage): Promise<void> {
  const selected = await loadLanguage(Langs, 'en', language)
  globalThis.CurrentLanguage = selected.locale.startsWith('pt') ? 'pt' : 'en'
  globalThis.Lang = selected.lang
  document.documentElement.lang = selected.locale
  localStorage.setItem(LANGUAGE_STORAGE_KEY, globalThis.CurrentLanguage)
}

export async function initializeLanguage(): Promise<void> {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
  await setLanguage(stored === 'en' || stored === 'pt' ? stored : undefined)
}
