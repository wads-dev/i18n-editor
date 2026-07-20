import type { AvailableLangs } from '@wads.dev/i18n-ts'

import type { EditorTranslation } from './base.js'

export type EditorLanguage = 'en' | 'pt'

export const Langs = {
  en: { name: 'English', short: 'EN', locale: 'en-US', lang: () => import('./en.js') },
  pt: { name: 'Português', short: 'PT', locale: 'pt-BR', lang: () => import('./pt.js') },
} satisfies AvailableLangs<EditorLanguage, EditorTranslation>
