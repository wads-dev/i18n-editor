import { assertBundle, type I18nBundle } from '@wads.dev/i18n-ts/bundle'
import {
  deleteKeyPathValue,
  getKeyPathValue,
  parseKeyPath,
  setKeyPathValue,
} from './keyPath.js'

export type MoveKeyOptions = {
  sourceKey: string
  targetKey: string
}

function cloneBundle(bundle: I18nBundle): I18nBundle {
  return structuredClone(bundle)
}

export function moveKey(bundle: I18nBundle, { sourceKey, targetKey }: MoveKeyOptions): I18nBundle {
  const validBundle = assertBundle(bundle)
  const sourceSegments = parseKeyPath(sourceKey, 'sourceKey')
  const targetSegments = parseKeyPath(targetKey, 'targetKey')

  if (sourceKey === targetKey) return cloneBundle(validBundle)
  if (targetKey.startsWith(`${sourceKey}.`) || targetKey.startsWith(`${sourceKey}[`)) {
    throw new Error('The destination key cannot be nested inside the source key.')
  }

  const valuesByLanguage = Object.entries(validBundle.languages).map(([languageKey, language]) => {
    const source = getKeyPathValue(language.translations, sourceSegments)
    if (!source.found) {
      throw new Error(`The source key does not exist in language "${languageKey}".`)
    }

    if (getKeyPathValue(language.translations, targetSegments).found) {
      throw new Error(`The destination key already exists in language "${languageKey}".`)
    }

    return [languageKey, source.value] as const
  })

  const nextBundle = cloneBundle(validBundle)
  valuesByLanguage.forEach(([languageKey, value]) => {
    const translations = nextBundle.languages[languageKey]!.translations
    deleteKeyPathValue(translations, sourceSegments)
    setKeyPathValue(translations, targetSegments, value)
  })

  return nextBundle
}
