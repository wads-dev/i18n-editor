import { assertBundle, type I18nBundle } from '@wads.dev/i18n-ts/bundle'
import {
  flattenPathReplacer,
  getLevelImport,
  normalizeProjectConfig,
  resolveImportAlias,
  type I18nPathReplacer,
  type I18nProjectConfig,
} from '@wads.dev/i18n-ts/config'

export type ExportPlanFile = {
  kind: 'base' | 'index' | 'language'
  languageKey?: string
  path: string
}

export type TranslationOwner = {
  directory: string
  keyPath: string
}

type ReplacementResult =
  | { found: false; value: undefined }
  | { found: true; value: string | null }

function appendPath(basePath: string, nextPath: string): string {
  return [basePath, nextPath]
    .filter(Boolean)
    .join('/')
    .replaceAll(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '')
}

function expandTemplate(template: string, value: string): string {
  return template.replaceAll('{value}', value)
}

function hasAlias(path: string, aliases: Record<string, string>): boolean {
  return Object.keys(aliases).some((alias) => path.startsWith(alias))
}

function getReplacement(
  replacer: I18nPathReplacer | undefined,
  fullKey: string,
  segment: string,
): ReplacementResult {
  const flattened = flattenPathReplacer(replacer)
  if (Object.hasOwn(flattened, fullKey)) return { found: true, value: flattened[fullKey] }
  if (Object.hasOwn(flattened, segment)) return { found: true, value: flattened[segment] }
  return { found: false, value: undefined }
}

export function getTranslationOwner(fullKey: string, config: I18nProjectConfig): TranslationOwner {
  const segments = fullKey.split('.')
  const groupCount = Math.min(config.levelCount, Math.max(segments.length - 1, 0))
  const rootImport = getLevelImport(config, 0)
  let directory = resolveImportAlias(expandTemplate(rootImport.path, ''), config.importAliases)
  let consumedSegments = 0

  for (let level = 1; level <= groupCount; level += 1) {
    const segment = segments[level - 1]!
    const objectPath = segments.slice(0, level).join('.')
    const levelImport = getLevelImport(config, level)
    const fullReplacement = getReplacement(levelImport.fullReplacer, objectPath, segment)

    if (fullReplacement.found) {
      if (fullReplacement.value !== null) {
        directory = resolveImportAlias(fullReplacement.value, config.importAliases)
        consumedSegments = level
      }
      break
    }

    const valueReplacement = getReplacement(levelImport.valueReplacer, objectPath, segment)
    const value = typeof valueReplacement.value === 'string' ? valueReplacement.value : segment
    const template = expandTemplate(levelImport.path, value)
    const resolved = resolveImportAlias(template, config.importAliases)
    directory = hasAlias(template, config.importAliases) || template.startsWith('/')
      ? resolved
      : appendPath(directory, resolved)
    consumedSegments = level
  }

  return {
    directory,
    keyPath: segments.slice(0, consumedSegments).join('.'),
  }
}

function isFunctionDescriptor(value: unknown): boolean {
  return value !== null
    && typeof value === 'object'
    && '$type' in value
    && value.$type === 'function'
}

function collectTranslationKeys(value: unknown, path = '', keys: string[] = []): string[] {
  if (isFunctionDescriptor(value)) {
    keys.push(path)
    return keys
  }
  if (Array.isArray(value)) {
    keys.push(path)
    return keys
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, nestedValue]) => {
      collectTranslationKeys(nestedValue, path ? `${path}.${key}` : key, keys)
    })
    return keys
  }

  keys.push(path)
  return keys
}

export function buildTranslationOwners(
  bundle: I18nBundle,
  config: I18nProjectConfig,
): TranslationOwner[] {
  const validBundle = assertBundle(bundle)
  const validConfig = normalizeProjectConfig(config)
  const owners = new Map<string, TranslationOwner>()
  const referenceLanguage = Object.values(validBundle.languages)[0]

  if (referenceLanguage) {
    collectTranslationKeys(referenceLanguage.translations).forEach((key) => {
      const owner = getTranslationOwner(key, validConfig)
      const existing = owners.get(owner.directory)
      if (existing && existing.keyPath !== owner.keyPath) {
        throw new Error(`The export path "${owner.directory}" resolves multiple translation owners.`)
      }
      owners.set(owner.directory, owner)
    })
  }

  return [...owners.values()].sort((left, right) => left.keyPath.localeCompare(right.keyPath))
}

export function buildExportPlan(
  bundle: I18nBundle,
  config: I18nProjectConfig,
): ExportPlanFile[] {
  const validBundle = assertBundle(bundle)
  const validConfig = normalizeProjectConfig(config)
  const owners = buildTranslationOwners(validBundle, validConfig)

  return owners
    .flatMap(({ directory, keyPath }) => {
      const translationsDirectory = appendPath(directory, validConfig.translationsDirectory)
      const structuralFiles: ExportPlanFile[] = [
        { kind: 'base', path: appendPath(translationsDirectory, 'base.ts') },
      ]
      if (keyPath === '') {
        structuralFiles.push({
          kind: 'index',
          path: (validConfig as I18nProjectConfig & { catalogFile?: string }).catalogFile
            || appendPath(translationsDirectory, 'index.ts'),
        })
      }
      const languageFiles: ExportPlanFile[] = Object.keys(validBundle.languages).map((languageKey) => {
        const language = validConfig.languageReplacer[languageKey] || languageKey
        return {
          kind: 'language',
          languageKey,
          path: appendPath(
            translationsDirectory,
            validConfig.languageFileTemplate.replaceAll('{language}', language),
          ),
        }
      })
      return [...structuralFiles, ...languageFiles]
    })
    .sort((left, right) => left.path.localeCompare(right.path))
}
