import type { I18nBundle } from '@wads.dev/i18n-ts/bundle'

export const REVIEW_BASELINE_FORMAT = 'wads-i18n-review-baseline'
export const REVIEW_BASELINE_VERSION = 1

export type ReviewBaseline = {
  format: typeof REVIEW_BASELINE_FORMAT
  version: typeof REVIEW_BASELINE_VERSION
  createdAt: number
  keys: string[]
}

function isFunctionDescriptor(value: unknown): value is { $type: 'function' } {
  return value !== null && typeof value === 'object' && (value as { $type?: unknown }).$type === 'function'
}

function appendSegment(keyPath: string, segment: string): string {
  return segment.startsWith('[') ? `${keyPath}${segment}` : keyPath ? `${keyPath}.${segment}` : segment
}

function collectTranslationKeys(value: unknown, keyPath = '', keys = new Set<string>()): Set<string> {
  if (isFunctionDescriptor(value)) {
    keys.add(keyPath)
    return keys
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectTranslationKeys(item, appendSegment(keyPath, `[${index}]`), keys))
    return keys
  }
  if (value !== null && typeof value === 'object') {
    Object.entries(value).forEach(([key, nestedValue]) => {
      collectTranslationKeys(nestedValue, appendSegment(keyPath, key), keys)
    })
    return keys
  }
  if (keyPath) keys.add(keyPath)
  return keys
}

export function getBundleTranslationKeys(bundle: I18nBundle): string[] {
  const keys = new Set<string>()
  Object.values(bundle.languages).forEach(({ translations }) => collectTranslationKeys(translations, '', keys))
  return [...keys].sort((left, right) => left.localeCompare(right))
}

export function createReviewBaseline(bundle: I18nBundle): ReviewBaseline {
  return {
    format: REVIEW_BASELINE_FORMAT,
    version: REVIEW_BASELINE_VERSION,
    createdAt: Date.now(),
    keys: getBundleTranslationKeys(bundle),
  }
}

export function getNewReviewKeys(bundle: I18nBundle, baseline: ReviewBaseline | null): string[] {
  if (!baseline) return []
  const reviewedKeys = new Set(baseline.keys)
  return getBundleTranslationKeys(bundle).filter((key) => !reviewedKeys.has(key))
}

export function getRemovedReviewKeys(bundle: I18nBundle, baseline: ReviewBaseline | null): string[] {
  if (!baseline) return []
  const currentKeys = new Set(getBundleTranslationKeys(bundle))
  return baseline.keys.filter((key) => !currentKeys.has(key))
}
