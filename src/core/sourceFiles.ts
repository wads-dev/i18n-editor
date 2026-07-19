import { assertBundle, type BundleValue, type I18nBundle } from '@wads.dev/i18n-ts/bundle'
import { normalizeProjectConfig, type I18nProjectConfig } from '@wads.dev/i18n-ts/config'

import { buildTranslationOwners, type TranslationOwner } from './exportPlan.js'

export type GeneratedSourceFile = {
  kind: 'base' | 'index' | 'language'
  path: string
  content: string
}

export type SourceGenerationOptions = {
  catalogFile?: string
  existingInterfaceNames?: Record<string, string>
  existingLanguageTypeName?: string
}

type ObjectNode = { [key: string]: SourceNode }
type SourceNode = BundleValue | TypeReference
type TypeReference = { $reference: string; $value: string }

function appendPath(basePath: string, nextPath: string): string {
  return [basePath, nextPath].filter(Boolean).join('/').replaceAll(/\/+/g, '/').replace(/^\.\//, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFunctionDescriptor(value: unknown): value is { $type: 'function'; source: string } {
  return isRecord(value) && value.$type === 'function' && typeof value.source === 'string'
}

function isTypeReference(value: unknown): value is TypeReference {
  return isRecord(value) && typeof value.$reference === 'string' && typeof value.$value === 'string'
}

function getAtPath(value: unknown, keyPath: string): unknown {
  if (!keyPath) return value
  return keyPath.split('.').reduce<unknown>((current, segment) => {
    return isRecord(current) ? current[segment] : undefined
  }, value)
}

function setAtPath(target: ObjectNode, segments: string[], value: SourceNode): void {
  let current = target
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = value
      return
    }
    const existing = current[segment]
    if (!isRecord(existing) || isFunctionDescriptor(existing) || isTypeReference(existing)) {
      current[segment] = {}
    }
    current = current[segment] as ObjectNode
  })
}

function toPascalCase(value: string): string {
  const result = value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ''}${part.slice(1)}`)
    .join('')
  return result || 'Project'
}

function toIdentifier(value: string): string {
  const pascal = toPascalCase(value)
  const identifier = `${pascal[0]?.toLowerCase() || ''}${pascal.slice(1)}`
  return /^[$A-Z_a-z]/.test(identifier) ? identifier : `_${identifier}`
}

function propertyName(value: string): string {
  return /^[$A-Z_a-z][$\w]*$/.test(value) ? value : JSON.stringify(value)
}

function getTypeName(owner: TranslationOwner, basePath: string, names: Record<string, string>): string {
  return names[basePath] || `${toPascalCase(owner.keyPath)}Translation`
}

function getFunctionType(source: string): string {
  const arrowIndex = source.indexOf('=>')
  if (arrowIndex < 0) return '(...args: any[]) => string'
  const rawParameters = source.slice(0, arrowIndex).trim().replace(/^async\s+/, '')
  const parameterText = rawParameters.startsWith('(')
    ? rawParameters.slice(1, rawParameters.lastIndexOf(')'))
    : rawParameters
  const parameters = parameterText
    .split(',')
    .map((parameter) => parameter.trim().replace(/=.*$/, '').replace(/^\.\.\./, '').trim())
    .filter((parameter) => /^[$A-Z_a-z][$\w]*$/.test(parameter))
    .map((parameter) => `${parameter}: any`)
  return `(${parameters.join(', ')}) => string`
}

function renderType(value: SourceNode, indentation: number): string {
  if (isTypeReference(value)) return value.$reference
  if (isFunctionDescriptor(value)) return getFunctionType(value.source)
  if (Array.isArray(value)) {
    if (value.length === 0) return 'unknown[]'
    const types = [...new Set(value.map((item) => renderType(item, indentation)))]
    return types.length === 1 ? `${types[0]}[]` : `Array<${types.join(' | ')}>`
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) return 'Record<string, never>'
    const pad = ' '.repeat(indentation)
    const childPad = ' '.repeat(indentation + 2)
    return `{\n${entries.map(([key, item]) => `${childPad}${propertyName(key)}: ${renderType(item as SourceNode, indentation + 2)};`).join('\n')}\n${pad}}`
  }
  if (value === null) return 'null'
  return typeof value
}

function renderValue(value: SourceNode, indentation: number): string {
  if (isTypeReference(value)) return value.$value
  if (isFunctionDescriptor(value)) return value.source
  if (Array.isArray(value)) return JSON.stringify(value, null, 2).replaceAll('\n', `\n${' '.repeat(indentation)}`)
  if (isRecord(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    const pad = ' '.repeat(indentation)
    const childPad = ' '.repeat(indentation + 2)
    return `{\n${entries.map(([key, item]) => `${childPad}${propertyName(key)}: ${renderValue(item as SourceNode, indentation + 2)},`).join('\n')}\n${pad}}`
  }
  return JSON.stringify(value)
}

function relativeImport(fromFile: string, toFile: string): string {
  const fromSegments = fromFile.split('/').slice(0, -1)
  const toSegments = toFile.replace(/\.ts$/, '').split('/')
  while (fromSegments[0] === toSegments[0]) {
    fromSegments.shift()
    toSegments.shift()
  }
  const relative = [...fromSegments.map(() => '..'), ...toSegments].join('/')
  return relative.startsWith('.') ? relative : `./${relative}`
}

function renderBaseFile(typeName: string, tree: ObjectNode, imports: Array<{ name: string; path: string }>): string {
  const importLines = [
    "import type { Translation } from '@wads.dev/i18n-ts'",
    ...imports.map((item) => `import type ${item.name} from '${item.path}'`),
  ]
  const body = Object.entries(tree)
    .map(([key, value]) => `  ${propertyName(key)}: ${renderType(value, 2)};`)
    .join('\n')
  return `${importLines.join('\n')}\n\nexport default interface ${typeName} extends Translation {\n${body}\n}\n`
}

function renderLanguageFile(
  variableName: string,
  typeName: string,
  tree: ObjectNode,
  imports: Array<{ name: string; path: string }>,
): string {
  const importLines = [
    ...imports.map((item) => `import ${item.name} from '${item.path}'`),
    `import type ${typeName} from './base'`,
  ]
  return `${importLines.join('\n')}\n\nconst ${variableName}: ${typeName} = ${renderValue(tree, 0)}\n\nexport default ${variableName}\n`
}

function renderIndexFile(
  bundle: I18nBundle,
  rootTypeName: string,
  languageTypeName: string,
  config: I18nProjectConfig,
  indexPath: string,
  rootBasePath: string,
): string {
  const languageKeys = Object.keys(bundle.languages)
  const languageUnion = languageKeys.map(JSON.stringify).join(' | ') || 'never'
  const entries = languageKeys.map((languageKey) => {
    const language = bundle.languages[languageKey]!
    const filename = config.languageReplacer[languageKey] || languageKey
    const languagePath = `${rootBasePath.slice(0, -'base.ts'.length)}${config.languageFileTemplate.replaceAll('{language}', filename)}`
    return `  ${propertyName(languageKey)}: {\n    lang: () => import('${relativeImport(indexPath, languagePath)}'),\n    name: ${JSON.stringify(language.name)},\n    short: ${JSON.stringify(language.short)},\n    locale: ${JSON.stringify(language.locale)},\n  },`
  })
  return `import type { AvailableLangs } from '@wads.dev/i18n-ts'\nimport type ${rootTypeName} from '${relativeImport(indexPath, rootBasePath)}'\n\nexport type ${languageTypeName} = ${languageUnion}\n\nexport const Langs: AvailableLangs<${languageTypeName}, ${rootTypeName}> = {\n${entries.join('\n')}\n}\n`
}

export function generateSourceFiles(
  bundle: I18nBundle,
  projectConfig: I18nProjectConfig,
  options: SourceGenerationOptions = {},
): GeneratedSourceFile[] {
  const validBundle = assertBundle(bundle)
  const config = normalizeProjectConfig(projectConfig)
  const owners = buildTranslationOwners(validBundle, config)
  const ownerByKey = new Map(owners.map((owner) => [owner.keyPath, owner]))
  const typeNames = new Map<string, string>()
  const basePaths = new Map<string, string>()

  owners.forEach((owner) => {
    const basePath = appendPath(appendPath(owner.directory, config.translationsDirectory), 'base.ts')
    basePaths.set(owner.keyPath, basePath)
    typeNames.set(owner.keyPath, getTypeName(owner, basePath, options.existingInterfaceNames || {}))
  })

  function getParent(owner: TranslationOwner): TranslationOwner | undefined {
    return owners
      .filter((candidate) => candidate.keyPath !== owner.keyPath)
      .filter((candidate) => !candidate.keyPath || owner.keyPath.startsWith(`${candidate.keyPath}.`))
      .sort((left, right) => right.keyPath.length - left.keyPath.length)[0]
  }

  const children = new Map<string, TranslationOwner[]>()
  owners.forEach((owner) => {
    const parent = getParent(owner)
    if (!parent) return
    children.set(parent.keyPath, [...(children.get(parent.keyPath) || []), owner])
  })

  const files: GeneratedSourceFile[] = []
  owners.forEach((owner) => {
    const translationDirectory = appendPath(owner.directory, config.translationsDirectory)
    const basePath = basePaths.get(owner.keyPath)!
    const typeName = typeNames.get(owner.keyPath)!
    const ownerChildren = children.get(owner.keyPath) || []
    const referenceTree = structuredClone(getAtPath(Object.values(validBundle.languages)[0]?.translations, owner.keyPath) || {}) as ObjectNode
    ownerChildren.forEach((child) => {
      const relativeSegments = child.keyPath.slice(owner.keyPath ? owner.keyPath.length + 1 : 0).split('.')
      setAtPath(referenceTree, relativeSegments, {
        $reference: typeNames.get(child.keyPath)!,
        $value: toIdentifier(child.keyPath),
      })
    })
    const baseImports = ownerChildren.map((child) => ({
      name: typeNames.get(child.keyPath)!,
      path: relativeImport(basePath, basePaths.get(child.keyPath)!),
    }))
    files.push({ kind: 'base', path: basePath, content: renderBaseFile(typeName, referenceTree, baseImports) })

    Object.entries(validBundle.languages).forEach(([languageKey, language]) => {
      const filenameValue = config.languageReplacer[languageKey] || languageKey
      const languagePath = appendPath(translationDirectory, config.languageFileTemplate.replaceAll('{language}', filenameValue))
      const tree = structuredClone(getAtPath(language.translations, owner.keyPath) || {}) as ObjectNode
      ownerChildren.forEach((child) => {
        const relativeSegments = child.keyPath.slice(owner.keyPath ? owner.keyPath.length + 1 : 0).split('.')
        setAtPath(tree, relativeSegments, {
          $reference: typeNames.get(child.keyPath)!,
          $value: toIdentifier(child.keyPath),
        })
      })
      const languageImports = ownerChildren.map((child) => {
        const childDirectory = appendPath(child.directory, config.translationsDirectory)
        const childPath = appendPath(childDirectory, config.languageFileTemplate.replaceAll('{language}', filenameValue))
        return { name: toIdentifier(child.keyPath), path: relativeImport(languagePath, childPath) }
      })
      files.push({
        kind: 'language',
        path: languagePath,
        content: renderLanguageFile(toIdentifier(filenameValue), typeName, tree, languageImports),
      })
    })
  })

  const rootOwner = ownerByKey.get('')
  if (rootOwner) {
    const rootBasePath = basePaths.get('')!
    const indexPath = options.catalogFile || appendPath(appendPath(rootOwner.directory, config.translationsDirectory), 'index.ts')
    files.push({
      kind: 'index',
      path: indexPath,
      content: renderIndexFile(
        validBundle,
        typeNames.get('')!,
        options.existingLanguageTypeName || 'I18nLanguage',
        config,
        indexPath,
        rootBasePath,
      ),
    })
  }

  return files.sort((left, right) => left.path.localeCompare(right.path))
}
