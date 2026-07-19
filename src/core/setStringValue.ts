import { assertBundle, type I18nBundle } from '@wads.dev/i18n-ts/bundle'
import { getKeyPathValue, parseKeyPath, setKeyPathValue } from './keyPath.js'

export type SetStringValueOptions = {
  languageKey: string
  key: string
  value: string
}

function cloneBundle(bundle: I18nBundle): I18nBundle {
  return structuredClone(bundle)
}

export function setStringValue(
  bundle: I18nBundle,
  { languageKey, key, value }: SetStringValueOptions,
): I18nBundle {
  const validBundle = assertBundle(bundle)
  const language = validBundle.languages[languageKey]
  if (!language) {
    throw new Error(`Language "${languageKey}" does not exist in the bundle.`)
  }

  const segments = parseKeyPath(key, 'key')
  const currentValue = getKeyPathValue(language.translations, segments)
  if (!currentValue.found) {
    throw new Error(`Key "${key}" does not exist in language "${languageKey}".`)
  }
  if (typeof currentValue.value !== 'string') {
    throw new Error('Editing functions and non-string values is not supported yet.')
  }

  const nextBundle = cloneBundle(validBundle)
  setKeyPathValue(nextBundle.languages[languageKey]!.translations, segments, value)
  return nextBundle
}
