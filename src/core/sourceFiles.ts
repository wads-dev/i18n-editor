import { assertBundle, type BundleValue, type I18nBundle } from '@wads.dev/i18n-ts/bundle'

import { buildTranslationOwners, type TranslationOwner } from './exportPlan.js'
import {
  normalizeEditorProjectConfig,
  type EditorProjectConfig,
  type I18nCodeFormatConfig,
} from './projectConfig.js'

export type GeneratedSourceFile = {
  kind: 'base' | 'index' | 'language'
  path: string
  content: string
}

export type SourceGenerationOptions = {
  catalogFile?: string
  existingInterfaceNames?: Record<string, string>
  existingLanguageTypeName?: string
  existingPropertyTypes?: Record<string, string>
  existingTypeImports?: Record<string, Array<{ name: string; path: string }>>
  existingValueImportOrder?: Record<string, string[]>
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

function quoteString(value: string, codeFormat: I18nCodeFormatConfig): string {
  if (codeFormat.useDoubleQuotes) return JSON.stringify(value)
  const escaped = [...value].map((character) => {
    if (character === "'") return "\\'"
    if (character === '\\') return '\\\\'
    if (character === '\n') return '\\n'
    if (character === '\r') return '\\r'
    if (character === '\t') return '\\t'
    if (character === '\b') return '\\b'
    if (character === '\f') return '\\f'
    const codePoint = character.codePointAt(0)!
    if (codePoint < 0x20 || codePoint === 0x2028 || codePoint === 0x2029) {
      return `\\u${codePoint.toString(16).padStart(4, '0')}`
    }
    return character
  }).join('')
  return `'${escaped}'`
}

function propertyName(value: string, codeFormat: I18nCodeFormatConfig): string {
  return /^[$A-Z_a-z][$\w]*$/.test(value) ? value : quoteString(value, codeFormat)
}

function indent(level: number, codeFormat: I18nCodeFormatConfig): string {
  const character = codeFormat.indentation.character === 'tab' ? '\t' : ' '
  return character.repeat(codeFormat.indentation.size * level)
}

function terminateStatement(value: string, codeFormat: I18nCodeFormatConfig): string {
  return `${value}${codeFormat.useSemicolons ? ';' : ''}`
}

function addCommas(values: string[], codeFormat: I18nCodeFormatConfig): string[] {
  return values.map((value, index) => {
    const needsComma = index < values.length - 1 || codeFormat.useTrailingCommas
    return `${value}${needsComma ? ',' : ''}`
  })
}

function renderCompactValue(value: SourceNode, codeFormat: I18nCodeFormatConfig): string | null {
  if (isTypeReference(value)) return value.$value
  if (isFunctionDescriptor(value)) return value.source.includes('\n') ? null : value.source
  if (Array.isArray(value)) {
    if (codeFormat.arrayLayout === 'multiline') return null
    if (value.length > codeFormat.maxArrayInlineItems) return null
    if (value.some((item) => Array.isArray(item) || (isRecord(item) && !isFunctionDescriptor(item) && !isTypeReference(item)))) return null
    const items = value.map((item) => renderCompactValue(item, codeFormat))
    if (items.some((item) => item === null)) return null
    return `[${items.join(', ')}]`
  }
  if (isRecord(value)) {
    if (codeFormat.objectLayout === 'multiline') return null
    if (Object.keys(value).length > codeFormat.maxObjectInlineItems) return null
    if (Object.values(value).some((item) => Array.isArray(item) || (isRecord(item) && !isFunctionDescriptor(item) && !isTypeReference(item)))) return null
    const properties = Object.entries(value).map(([key, item]) => {
      const renderedValue = renderCompactValue(item as SourceNode, codeFormat)
      if (renderedValue === null) return null
      const canUseShorthand = codeFormat.useShorthandProperties
        && /^[$A-Z_a-z][$\w]*$/.test(key)
        && renderedValue === key
      return canUseShorthand ? key : `${propertyName(key, codeFormat)}: ${renderedValue}`
    })
    if (properties.some((property) => property === null)) return null
    return `{ ${properties.join(', ')} }`
  }
  if (typeof value === 'string') return quoteString(value, codeFormat)
  return JSON.stringify(value)
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

function renderType(
  value: SourceNode,
  level: number,
  keyPath: string,
  existingPropertyTypes: Record<string, string>,
  codeFormat: I18nCodeFormatConfig,
): string {
  if (isTypeReference(value)) return value.$reference
  if (existingPropertyTypes[keyPath]) return existingPropertyTypes[keyPath]
  if (isFunctionDescriptor(value)) return getFunctionType(value.source)
  if (Array.isArray(value)) {
    if (value.length === 0) return 'unknown[]'
    const types = [...new Set(value.map((item) => renderType(item, level, keyPath, existingPropertyTypes, codeFormat)))]
    return types.length === 1 ? `${types[0]}[]` : `Array<${types.join(' | ')}>`
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) return 'Record<string, never>'
    const pad = indent(level, codeFormat)
    const childPad = indent(level + 1, codeFormat)
    return `{\n${entries.map(([key, item]) => {
      const childPath = keyPath ? `${keyPath}.${key}` : key
      const member = `${childPad}${propertyName(key, codeFormat)}: ${renderType(item as SourceNode, level + 1, childPath, existingPropertyTypes, codeFormat)}`
      return terminateStatement(member, codeFormat)
    }).join('\n')}\n${pad}}`
  }
  if (value === null) return 'null'
  return typeof value
}

function renderValue(
  value: SourceNode,
  level: number,
  codeFormat: I18nCodeFormatConfig,
  currentColumn = 0,
  allowInline = true,
): string {
  if (isTypeReference(value)) return value.$value
  if (isFunctionDescriptor(value)) return value.source
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const compact = allowInline ? renderCompactValue(value, codeFormat) : null
    if (compact !== null && currentColumn + compact.length <= codeFormat.printWidth) return compact
    const pad = indent(level, codeFormat)
    const childPad = indent(level + 1, codeFormat)
    const items = value.map((item) => `${childPad}${renderValue(item, level + 1, codeFormat, childPad.length)}`)
    return `[\n${addCommas(items, codeFormat).join('\n')}\n${pad}]`
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    const compact = allowInline ? renderCompactValue(value, codeFormat) : null
    if (compact !== null && currentColumn + compact.length <= codeFormat.printWidth) return compact
    const pad = indent(level, codeFormat)
    const childPad = indent(level + 1, codeFormat)
    const properties = entries.map(([key, item]) => {
      const renderedKey = propertyName(key, codeFormat)
      const valueColumn = childPad.length + renderedKey.length + 2
      const renderedValue = renderValue(item as SourceNode, level + 1, codeFormat, valueColumn)
      const canUseShorthand = codeFormat.useShorthandProperties
        && /^[$A-Z_a-z][$\w]*$/.test(key)
        && renderedValue === key
      return `${childPad}${canUseShorthand ? key : `${renderedKey}: ${renderedValue}`}`
    })
    return `{\n${addCommas(properties, codeFormat).join('\n')}\n${pad}}`
  }
  if (typeof value === 'string') return quoteString(value, codeFormat)
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

function aliasedImport(toFile: string, aliases: Record<string, string>): string | null {
  const normalizedTarget = toFile.replace(/\.ts$/, '')
  const match = Object.entries(aliases)
    .filter(([, target]) => {
      const prefix = target.replace(/\/$/, '')
      return normalizedTarget === prefix || normalizedTarget.startsWith(`${prefix}/`)
    })
    .sort((left, right) => right[1].length - left[1].length)[0]
  if (!match) return null
  const [alias, target] = match
  const normalizedAlias = alias.endsWith('/') ? alias : `${alias}/`
  const normalizedPrefix = target.replace(/\/$/, '')
  const remainder = normalizedTarget.slice(normalizedPrefix.length).replace(/^\//, '')
  return `${normalizedAlias}${remainder}`
}

function generatedImport(
  fromFile: string,
  toFile: string,
  owner: TranslationOwner,
  config: EditorProjectConfig,
): string {
  if (owner.importPathStyle === 'alias') {
    const aliased = aliasedImport(toFile, config.exportConfig.importAliases)
    if (aliased) return aliased
  }
  return relativeImport(fromFile, toFile)
}

function ownerIdentifier(owner: TranslationOwner): string {
  return toIdentifier(owner.keyPath.split('.').at(-1) || owner.keyPath)
}

function orderChildrenByExistingImports(
  children: TranslationOwner[],
  childPaths: Map<string, string>,
  existingOrder: string[] = [],
): TranslationOwner[] {
  const ranks = new Map(existingOrder.map((targetPath, index) => [targetPath, index]))
  return [...children].sort((left, right) => {
    const leftRank = ranks.get(childPaths.get(left.keyPath) || '') ?? Number.POSITIVE_INFINITY
    const rightRank = ranks.get(childPaths.get(right.keyPath) || '') ?? Number.POSITIVE_INFINITY
    return leftRank - rightRank
  })
}

function renderBaseFile(
  typeName: string,
  ownerKeyPath: string,
  tree: ObjectNode,
  imports: Array<{ name: string; path: string }>,
  existingPropertyTypes: Record<string, string>,
  codeFormat: I18nCodeFormatConfig,
): string {
  const importLines = [
    `import type { Translation } from ${quoteString('@wads.dev/i18n-ts', codeFormat)}`,
    ...imports.map((item) => `import type ${item.name} from ${quoteString(item.path, codeFormat)}`),
  ].map((line) => terminateStatement(line, codeFormat))
  const body = Object.entries(tree)
    .map(([key, value]) => {
      const keyPath = ownerKeyPath ? `${ownerKeyPath}.${key}` : key
      const member = `${indent(1, codeFormat)}${propertyName(key, codeFormat)}: ${renderType(value, 1, keyPath, existingPropertyTypes, codeFormat)}`
      return terminateStatement(member, codeFormat)
    })
    .join('\n')
  return `${importLines.join('\n')}\n\nexport default interface ${typeName} extends Translation {\n${body}\n}\n`
}

function renderLanguageFile(
  variableName: string,
  typeName: string,
  tree: ObjectNode,
  imports: Array<{ name: string; path: string }>,
  codeFormat: I18nCodeFormatConfig,
): string {
  const importLines = [
    ...imports.map((item) => `import ${item.name} from ${quoteString(item.path, codeFormat)}`),
    `import type ${typeName} from ${quoteString('./base', codeFormat)}`,
  ].map((line) => terminateStatement(line, codeFormat))
  const declaration = terminateStatement(`const ${variableName}: ${typeName} = ${renderValue(tree, 0, codeFormat, 0, false)}`, codeFormat)
  const exportLine = terminateStatement(`export default ${variableName}`, codeFormat)
  return `${importLines.join('\n')}\n\n${declaration}\n\n${exportLine}\n`
}

function renderIndexFile(
  bundle: I18nBundle,
  rootTypeName: string,
  languageTypeName: string,
  config: EditorProjectConfig,
  indexPath: string,
  rootBasePath: string,
): string {
  const languageKeys = Object.keys(bundle.languages)
  const codeFormat = config.exportConfig.codeFormat
  const languageUnion = languageKeys.map((key) => quoteString(key, codeFormat)).join(' | ') || 'never'
  const entries = languageKeys.map((languageKey) => {
    const language = bundle.languages[languageKey]!
    const filename = config.languageReplacer[languageKey] || languageKey
    const languagePath = `${rootBasePath.slice(0, -'base.ts'.length)}${config.languageFileTemplate.replaceAll('{language}', filename)}`
    const properties = addCommas([
      `${indent(2, codeFormat)}lang: () => import(${quoteString(relativeImport(indexPath, languagePath), codeFormat)})`,
      `${indent(2, codeFormat)}name: ${quoteString(language.name, codeFormat)}`,
      `${indent(2, codeFormat)}short: ${quoteString(language.short, codeFormat)}`,
      `${indent(2, codeFormat)}locale: ${quoteString(language.locale, codeFormat)}`,
    ], codeFormat)
    return `${indent(1, codeFormat)}${propertyName(languageKey, codeFormat)}: {\n${properties.join('\n')}\n${indent(1, codeFormat)}}`
  })
  const imports = [
    terminateStatement(`import type { AvailableLangs } from ${quoteString('@wads.dev/i18n-ts', codeFormat)}`, codeFormat),
    terminateStatement(`import type ${rootTypeName} from ${quoteString(relativeImport(indexPath, rootBasePath), codeFormat)}`, codeFormat),
  ]
  const typeDeclaration = terminateStatement(`export type ${languageTypeName} = ${languageUnion}`, codeFormat)
  const langsDeclaration = terminateStatement(
    `export const Langs: AvailableLangs<${languageTypeName}, ${rootTypeName}> = {\n${addCommas(entries, codeFormat).join('\n')}\n}`,
    codeFormat,
  )
  return `${imports.join('\n')}\n\n${typeDeclaration}\n\n${langsDeclaration}\n`
}

export function generateSourceFiles(
  bundle: I18nBundle,
  projectConfig: EditorProjectConfig,
  options: SourceGenerationOptions = {},
): GeneratedSourceFile[] {
  const validBundle = assertBundle(bundle)
  const config = normalizeEditorProjectConfig(projectConfig)
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
        $value: ownerIdentifier(child),
      })
    })
    const generatedBaseImports = ownerChildren.map((child) => ({
      name: typeNames.get(child.keyPath)!,
      path: generatedImport(basePath, basePaths.get(child.keyPath)!, child, config),
    }))
    const generatedImportNames = new Set(generatedBaseImports.map((item) => item.name))
    const preservedBaseImports = (options.existingTypeImports?.[basePath] || [])
      .filter((item) => !generatedImportNames.has(item.name))
    const baseImports = [...generatedBaseImports, ...preservedBaseImports]
    files.push({
      kind: 'base',
      path: basePath,
      content: renderBaseFile(
        typeName,
        owner.keyPath,
        referenceTree,
        baseImports,
        options.existingPropertyTypes || {},
        config.exportConfig.codeFormat,
      ),
    })

    Object.entries(validBundle.languages).forEach(([languageKey, language]) => {
      const filenameValue = config.languageReplacer[languageKey] || languageKey
      const languagePath = appendPath(translationDirectory, config.languageFileTemplate.replaceAll('{language}', filenameValue))
      const tree = structuredClone(getAtPath(language.translations, owner.keyPath) || {}) as ObjectNode
      ownerChildren.forEach((child) => {
        const relativeSegments = child.keyPath.slice(owner.keyPath ? owner.keyPath.length + 1 : 0).split('.')
        setAtPath(tree, relativeSegments, {
          $reference: typeNames.get(child.keyPath)!,
          $value: ownerIdentifier(child),
        })
      })
      const childPaths = new Map(ownerChildren.map((child) => {
        const childDirectory = appendPath(child.directory, config.translationsDirectory)
        const childPath = appendPath(childDirectory, config.languageFileTemplate.replaceAll('{language}', filenameValue))
        return [child.keyPath, childPath] as const
      }))
      const orderedChildren = orderChildrenByExistingImports(
        ownerChildren,
        childPaths,
        options.existingValueImportOrder?.[languagePath],
      )
      const languageImports = orderedChildren.map((child) => {
        const childPath = childPaths.get(child.keyPath)!
        return {
          name: ownerIdentifier(child),
          path: generatedImport(languagePath, childPath, child, config),
        }
      })
      files.push({
        kind: 'language',
        path: languagePath,
        content: renderLanguageFile(
          toIdentifier(filenameValue),
          typeName,
          tree,
          languageImports,
          config.exportConfig.codeFormat,
        ),
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
