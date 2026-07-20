import { assertBundle, type I18nBundle } from '@wads.dev/i18n-ts/bundle'
import { deleteKeyPathValue, getKeyPathValue, parseKeyPath } from './keyPath.js'

export type RemoveKeyOptions = {
  key: string
}

export function removeKey(bundle: I18nBundle, { key }: RemoveKeyOptions): I18nBundle {
  const validBundle = assertBundle(bundle)
  const segments = parseKeyPath(key, 'key')

  Object.entries(validBundle.languages).forEach(([languageKey, language]) => {
    if (!getKeyPathValue(language.translations, segments).found) {
      throw new Error(`Key "${key}" does not exist in language "${languageKey}".`)
    }
  })

  const nextBundle = structuredClone(validBundle)
  Object.values(nextBundle.languages).forEach((language) => {
    deleteKeyPathValue(language.translations, segments)
  })
  return nextBundle
}
