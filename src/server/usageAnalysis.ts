import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import ts from 'typescript'
import type { I18nBundle } from '@wads.dev/i18n-ts/bundle'
import { collectHtmlI18nReferences } from '@wads.dev/i18n-html/usage'

import { buildTranslationOwners } from '../core/exportPlan.js'
import type { EditorProjectConfig } from '../core/projectConfig.js'
import type { TranslationUsageEntry, TranslationUsageReport, TranslationUsageResponse } from '../core/projectApi.js'

type UsageAnalysisOptions = {
  projectDirectory: string
  bundle: I18nBundle
  config: EditorProjectConfig
}

const USAGE_CACHE_FORMAT = 'wads-i18n-usage-cache'
const USAGE_CACHE_VERSION = 1

type UsageCache = {
  format: typeof USAGE_CACHE_FORMAT
  version: typeof USAGE_CACHE_VERSION
  fingerprint: string
  report: TranslationUsageReport
}

function collectLeafKeys(value: unknown, prefix = '', result: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectLeafKeys(item, `${prefix}[${index}]`, result))
    return result
  }
  if (value !== null && typeof value === 'object' && !('$type' in value)) {
    Object.entries(value).forEach(([key, child]) => {
      collectLeafKeys(child, prefix ? `${prefix}.${key}` : key, result)
    })
    return result
  }
  if (prefix) result.push(prefix)
  return result
}

function usageCachePath(projectDirectory: string): string {
  return path.join(projectDirectory, 'node_modules', '.cache', '@wads.dev', 'i18n-editor', 'usage.json')
}

function usageFingerprint(bundle: I18nBundle, config: EditorProjectConfig): string {
  const referenceLanguage = Object.values(bundle.languages)[0]
  const keys = referenceLanguage ? collectLeafKeys(referenceLanguage.translations).sort() : []
  return createHash('sha256').update(JSON.stringify({
    keys,
    catalogFile: config.catalogFile,
    levelImports: config.levelImports,
    translationsDirectory: config.translationsDirectory,
    importAliases: config.exportConfig.importAliases,
  })).digest('hex')
}

async function readUsageCache(filePath: string): Promise<UsageCache | null> {
  try {
    const cache = JSON.parse(await fsPromises.readFile(filePath, 'utf8')) as UsageCache
    if (cache.format !== USAGE_CACHE_FORMAT
      || cache.version !== USAGE_CACHE_VERSION
      || !cache.report?.entries) return null
    return cache
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

async function writeUsageCache(filePath: string, cache: UsageCache): Promise<void> {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  try {
    await fsPromises.writeFile(temporaryPath, `${JSON.stringify(cache)}\n`, 'utf8')
    await fsPromises.rename(temporaryPath, filePath)
  } catch (error) {
    await fsPromises.rm(temporaryPath, { force: true })
    throw error
  }
}

export async function inspectTranslationUsageCache(
  options: UsageAnalysisOptions,
): Promise<TranslationUsageResponse> {
  const filePath = usageCachePath(options.projectDirectory)
  const fingerprint = usageFingerprint(options.bundle, options.config)
  const cache = await readUsageCache(filePath)
  if (!cache) return { cacheStatus: 'missing', report: null }
  return {
    cacheStatus: cache.fingerprint === fingerprint ? 'verified' : 'unverified',
    report: cache.report,
  }
}

export async function refreshTranslationUsageCache(
  options: UsageAnalysisOptions,
): Promise<TranslationUsageResponse> {
  const filePath = usageCachePath(options.projectDirectory)
  const fingerprint = usageFingerprint(options.bundle, options.config)
  const report = analyzeTranslationUsage(options)
  await writeUsageCache(filePath, {
    format: USAGE_CACHE_FORMAT,
    version: USAGE_CACHE_VERSION,
    fingerprint,
    report,
  })
  return { cacheStatus: 'verified', report }
}

export async function analyzeTranslationUsageCached(
  options: UsageAnalysisOptions,
  refresh = false,
): Promise<TranslationUsageReport> {
  if (!refresh) {
    const cached = await inspectTranslationUsageCache(options)
    if (cached.cacheStatus === 'verified' && cached.report) return cached.report
  }
  return (await refreshTranslationUsageCache(options)).report!
}

function normalizePath(value: string): string {
  return value.replaceAll(path.sep, '/')
}

function isInside(filePath: string, directory: string): boolean {
  const relative = path.relative(directory, filePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function findRootInterface(sourceFile: ts.SourceFile): ts.InterfaceDeclaration | undefined {
  const interfaces = sourceFile.statements.filter((statement): statement is ts.InterfaceDeclaration => {
    return ts.isInterfaceDeclaration(statement)
  })
  return interfaces.find((statement) => {
    return statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) === true
  }) || interfaces[0]
}

function getTypeSymbol(type: ts.Type): ts.Symbol | undefined {
  return type.aliasSymbol || type.getSymbol()
}

export function analyzeTranslationUsage({
  projectDirectory,
  bundle,
  config,
}: UsageAnalysisOptions): TranslationUsageReport {
  const tsconfigPath = ts.findConfigFile(projectDirectory, fs.existsSync, 'tsconfig.json')
  if (!tsconfigPath) throw new Error(`Could not find tsconfig.json from ${projectDirectory}.`)
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
  if (configFile.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'))
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath))
  if (parsed.errors.length > 0) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => projectDirectory,
      getNewLine: () => '\n',
    }))
  }

  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options })
  const checker = program.getTypeChecker()
  const referenceLanguage = Object.values(bundle.languages)[0]
  if (!referenceLanguage) throw new Error('The bundle does not contain any languages.')
  const leafKeys = collectLeafKeys(referenceLanguage.translations).sort((left, right) => left.localeCompare(right))
  const leafKeySet = new Set(leafKeys)
  const owners = buildTranslationOwners(bundle, config)
  const rootOwner = owners.find((owner) => owner.keyPath === '')
  if (!rootOwner) throw new Error('Could not resolve the root translation owner.')
  const rootBasePath = path.resolve(projectDirectory, rootOwner.directory, config.translationsDirectory, 'base.ts')
  const rootSource = program.getSourceFile(rootBasePath)
  if (!rootSource) throw new Error(`The root translation type is not part of the TypeScript program: ${rootBasePath}`)
  const rootInterface = findRootInterface(rootSource)
  if (!rootInterface) throw new Error(`Could not find a default exported interface in ${rootBasePath}.`)
  const rootTypeNode = rootInterface

  const keysBySymbol = new Map<ts.Symbol, Set<string>>()
  const collectionKeysBySymbol = new Map<ts.Symbol, Set<string>>()
  const collectionPrefixesBySymbol = new Map<ts.Symbol, Set<string>>()
  const prefixesByTypeSymbol = new Map<ts.Symbol, Set<string>>()

  function canonicalSymbols(symbol: ts.Symbol): ts.Symbol[] {
    return [...new Set([symbol, ...checker.getRootSymbols(symbol)])]
  }

  function registerSymbol(map: Map<ts.Symbol, Set<string>>, symbol: ts.Symbol, values: Iterable<string>): void {
    canonicalSymbols(symbol).forEach((candidate) => {
      const registered = map.get(candidate) || new Set<string>()
      for (const value of values) registered.add(value)
      map.set(candidate, registered)
    })
  }

  function getSymbolValues(map: Map<ts.Symbol, Set<string>>, symbol: ts.Symbol | undefined): Set<string> {
    if (!symbol) return new Set()
    return new Set(canonicalSymbols(symbol).flatMap((candidate) => [...(map.get(candidate) || [])]))
  }

  function descendantKeys(prefix: string): string[] {
    return leafKeys.filter((key) => key === prefix || key.startsWith(`${prefix}.`) || key.startsWith(`${prefix}[`))
  }

  function visitValue(value: unknown, type: ts.Type, prefix: string, ownerSymbol?: ts.Symbol): void {
    const typeSymbol = getTypeSymbol(type)
    if (typeSymbol) {
      const prefixes = prefixesByTypeSymbol.get(typeSymbol) || new Set<string>()
      prefixes.add(prefix)
      prefixesByTypeSymbol.set(typeSymbol, prefixes)
    }
    if (ownerSymbol) {
      if (leafKeySet.has(prefix)) registerSymbol(keysBySymbol, ownerSymbol, [prefix])
      else {
        registerSymbol(collectionKeysBySymbol, ownerSymbol, descendantKeys(prefix))
        registerSymbol(collectionPrefixesBySymbol, ownerSymbol, [prefix])
      }
    }
    if (Array.isArray(value)) {
      const elementType = checker.getIndexTypeOfType(type, ts.IndexKind.Number)
      if (!elementType) return
      value.forEach((item, index) => visitValue(item, elementType, `${prefix}[${index}]`))
      return
    }
    if (value !== null && typeof value === 'object' && !('$type' in value)) {
      Object.entries(value).forEach(([propertyName, child]) => {
        const property = type.getProperty(propertyName)
        if (!property) return
        const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? rootTypeNode
        const childType = checker.getTypeOfSymbolAtLocation(property, declaration)
        visitValue(child, childType, prefix ? `${prefix}.${propertyName}` : propertyName, property)
      })
    }
  }

  visitValue(referenceLanguage.translations, checker.getTypeAtLocation(rootInterface), '')

  const references = new Map<string, TranslationUsageEntry['references']>(leafKeys.map((key) => [key, []]))
  const uncertainReferences = new Map<string, TranslationUsageEntry['uncertainReferences']>(leafKeys.map((key) => [key, []]))
  const uncertainKeys = new Set<string>()
  const managedDirectories = owners.map((owner) => {
    return path.resolve(projectDirectory, owner.directory, config.translationsDirectory)
  })

  function addReference(key: string, node: ts.Node): void {
    const sourceFile = node.getSourceFile()
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    addReferenceLocation(key, {
      file: normalizePath(path.relative(projectDirectory, sourceFile.fileName)),
      line: position.line + 1,
      column: position.character + 1,
    })
  }

  function addReferenceLocation(key: string, reference: TranslationUsageEntry['references'][number]): void {
    const entries = references.get(key)
    if (!entries?.some((entry) => entry.file === reference.file
      && entry.line === reference.line
      && entry.column === reference.column)) entries?.push(reference)
  }

  function locationFor(node: ts.Node): TranslationUsageEntry['references'][number] {
    const sourceFile = node.getSourceFile()
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    return {
      file: normalizePath(path.relative(projectDirectory, sourceFile.fileName)),
      line: position.line + 1,
      column: position.character + 1,
    }
  }

  function addUncertainReference(key: string, node: ts.Node): void {
    const location = locationFor(node)
    const entries = uncertainReferences.get(key)
    if (!entries?.some((entry) => entry.file === location.file
      && entry.line === location.line
      && entry.column === location.column)) entries?.push(location)
  }

  function markUncertain(type: ts.Type, node: ts.Node): void {
    const symbol = getTypeSymbol(type)
    if (!symbol) return
    const prefixes = prefixesByTypeSymbol.get(symbol)
    prefixes?.forEach((prefix) => {
      const dottedPrefix = prefix ? `${prefix}.` : ''
      leafKeys.filter((key) => key === prefix || key.startsWith(dottedPrefix)).forEach((key) => {
        uncertainKeys.add(key)
        addUncertainReference(key, node)
      })
    })
  }

  function markKeysUncertain(keys: Iterable<string>, node: ts.Node): void {
    for (const key of keys) {
      uncertainKeys.add(key)
      addUncertainReference(key, node)
    }
  }

  function isContinuedTranslationAccess(node: ts.PropertyAccessExpression): boolean {
    const parent = node.parent
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      const nextSymbol = checker.getSymbolAtLocation(parent.name)
      return getSymbolValues(keysBySymbol, nextSymbol).size > 0
        || getSymbolValues(collectionKeysBySymbol, nextSymbol).size > 0
    }
    if (ts.isElementAccessExpression(parent) && parent.expression === node) return true
    return false
  }

  function isSelectorResult(node: ts.PropertyAccessExpression): boolean {
    let current: ts.Expression = node
    while (ts.isParenthesizedExpression(current.parent) && current.parent.expression === current) {
      current = current.parent
    }
    return ts.isArrowFunction(current.parent) && current.parent.body === current
  }

  function visitNode(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node)) {
      const symbol = checker.getSymbolAtLocation(node.name)
      getSymbolValues(keysBySymbol, symbol).forEach((key) => addReference(key, node.name))
      if (!isContinuedTranslationAccess(node) && !isSelectorResult(node)) {
        markKeysUncertain(getSymbolValues(collectionKeysBySymbol, symbol), node.name)
      }
    } else if (ts.isElementAccessExpression(node)) {
      const argument = node.argumentExpression
      if (ts.isStringLiteralLike(argument)) {
        const property = checker.getTypeAtLocation(node.expression).getProperty(argument.text)
        getSymbolValues(keysBySymbol, property).forEach((key) => addReference(key, argument))
        markKeysUncertain(getSymbolValues(collectionKeysBySymbol, property), argument)
      } else if (ts.isNumericLiteral(argument)) {
        const expressionSymbol = ts.isPropertyAccessExpression(node.expression)
          ? checker.getSymbolAtLocation(node.expression.name)
          : checker.getSymbolAtLocation(node.expression)
        getSymbolValues(collectionPrefixesBySymbol, expressionSymbol).forEach((prefix) => {
          const indexedKey = `${prefix}[${argument.text}]`
          if (leafKeySet.has(indexedKey)) addReference(indexedKey, argument)
          else markKeysUncertain(descendantKeys(indexedKey), argument)
        })
      } else {
        markUncertain(checker.getTypeAtLocation(node.expression), argument)
        const expressionSymbol = ts.isPropertyAccessExpression(node.expression)
          ? checker.getSymbolAtLocation(node.expression.name)
          : checker.getSymbolAtLocation(node.expression)
        markKeysUncertain(getSymbolValues(collectionKeysBySymbol, expressionSymbol), argument)
      }
    }
    ts.forEachChild(node, visitNode)
  }

  program.getSourceFiles()
    .filter((sourceFile) => !sourceFile.isDeclarationFile)
    .filter((sourceFile) => isInside(sourceFile.fileName, projectDirectory))
    .filter((sourceFile) => !managedDirectories.some((directory) => isInside(sourceFile.fileName, directory)))
    .forEach(visitNode)

  const htmlReferences = collectHtmlI18nReferences({
    directory: projectDirectory,
    ignoredDirectories: managedDirectories,
  })
  htmlReferences.forEach((reference) => {
    if (!leafKeySet.has(reference.key)) return
    addReferenceLocation(reference.key, reference)
  })

  const entries = Object.fromEntries(leafKeys.map((key): [string, TranslationUsageEntry] => {
    const keyReferences = references.get(key) || []
    const keyUncertainReferences = uncertainReferences.get(key) || []
    const displayedReferences = keyReferences.length > 0 ? keyReferences : keyUncertainReferences
    const fileCount = new Set(displayedReferences.map((reference) => reference.file)).size
    return [key, {
      status: keyReferences.length > 0 ? 'used' : uncertainKeys.has(key) ? 'uncertain' : 'unreferenced',
      referenceCount: keyReferences.length,
      uncertainReferenceCount: keyUncertainReferences.length,
      fileCount,
      references: keyReferences,
      uncertainReferences: keyUncertainReferences,
    }]
  }))
  const analyzedSourceFiles = program.getSourceFiles()
    .filter((sourceFile) => !sourceFile.isDeclarationFile)
    .filter((sourceFile) => isInside(sourceFile.fileName, projectDirectory))
    .filter((sourceFile) => !managedDirectories.some((directory) => isInside(sourceFile.fileName, directory)))
  return {
    analyzedAt: Date.now(),
    sourceFileCount: analyzedSourceFiles.length + new Set(htmlReferences.map((reference) => reference.file)).size,
    entries,
  }
}
