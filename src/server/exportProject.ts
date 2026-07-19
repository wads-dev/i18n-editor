import fs from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import type { I18nBundle } from '@wads.dev/i18n-ts/bundle'
import { resolveImportAlias } from '@wads.dev/i18n-ts/config'
import { createTwoFilesPatch } from 'diff'

import type { EditorProjectConfig, I18nDeletionConfig } from '../core/projectConfig.js'
import { buildExportPlan, buildTranslationOwners } from '../core/exportPlan.js'
import { generateSourceFiles, type GeneratedSourceFile } from '../core/sourceFiles.js'
import { createProjectContext, type ProjectContextOptions } from './projectContext.js'

export type ProjectExportChange = {
  kind: GeneratedSourceFile['kind'] | 'obsolete'
  path: string
  absolutePath: string
  status: 'create' | 'modify' | 'unchanged' | 'delete'
  content?: string
  diff?: string
}

export type ProjectExportPlan = {
  projectDirectory: string
  bundlePath: string
  changes: ProjectExportChange[]
  managedDirectories: string[]
  deletion: false | I18nDeletionConfig
}

export type ProjectExportState = {
  bundle: I18nBundle
  config: EditorProjectConfig
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function assertInsideProject(projectDirectory: string, filePath: string): string {
  const absolutePath = path.resolve(projectDirectory, filePath)
  const relativePath = path.relative(projectDirectory, absolutePath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Refusing to write outside the project directory: ${filePath}`)
  }
  return absolutePath
}

function readInterfaceName(content: string | null): string | null {
  return content?.match(/export\s+default\s+interface\s+([$A-Z_a-z][$\w]*)/)?.[1] || null
}

function readLanguageTypeName(content: string | null): string | null {
  return content?.match(/export\s+type\s+([$A-Z_a-z][$\w]*)\s*=/)?.[1] || null
}

function readPropertyTypes(content: string | null, ownerKeyPath: string): Record<string, string> {
  if (!content) return {}
  const sourceFile = ts.createSourceFile('base.ts', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const result: Record<string, string> = {}
  const interfaceNode = sourceFile.statements.find((statement): statement is ts.InterfaceDeclaration => {
    return ts.isInterfaceDeclaration(statement)
      && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) === true
  })
  if (!interfaceNode) return result

  function visit(members: ts.NodeArray<ts.TypeElement>, parentPath: string): void {
    members.forEach((member) => {
      if (!ts.isPropertySignature(member) || !member.type || !member.name) return
      const name = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
        ? member.name.text
        : member.name.getText(sourceFile)
      const keyPath = parentPath ? `${parentPath}.${name}` : name
      if (ts.isTypeLiteralNode(member.type)) visit(member.type.members, keyPath)
      else result[keyPath] = member.type.getText(sourceFile)
    })
  }

  visit(interfaceNode.members, ownerKeyPath)
  return result
}

function readTypeImports(content: string | null): Array<{ name: string; path: string }> {
  if (!content) return []
  const sourceFile = ts.createSourceFile('base.ts', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  return sourceFile.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement)
      || !statement.importClause?.name
      || !ts.isStringLiteral(statement.moduleSpecifier)) return []
    return [{ name: statement.importClause.name.text, path: statement.moduleSpecifier.text }]
  })
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replaceAll(path.sep, '/').replaceAll(/\/+/g, '/')
}

function resolveTypeImportPath(
  baseFilePath: string,
  importPath: string,
  config: EditorProjectConfig,
): string | null {
  let resolved: string
  if (importPath.startsWith('.')) {
    resolved = path.posix.normalize(path.posix.join(path.posix.dirname(baseFilePath), importPath))
  } else {
    resolved = resolveImportAlias(importPath, config.exportConfig.importAliases)
    if (resolved === importPath) return null
  }
  return /\.[cm]?[jt]sx?$/.test(resolved) ? resolved : `${resolved}.ts`
}

function isInsideDirectory(filePath: string, directory: string): boolean {
  return filePath === directory || filePath.startsWith(`${directory}/`)
}

function isIgnoredDeletionFile(filePath: string, deletion: I18nDeletionConfig): boolean {
  return deletion.ignoredExtensions.includes(path.extname(filePath).toLowerCase())
}

async function listManagedFiles(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    const nested = await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory() && !entry.isSymbolicLink()) return listManagedFiles(entryPath)
      return [entryPath]
    }))
    return nested.flat()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function removeEmptyDescendants(directory: string): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  await Promise.all(entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map(async (entry) => {
    const childPath = path.join(directory, entry.name)
    await removeEmptyDescendants(childPath)
    try {
      await fs.rmdir(childPath)
    } catch (error) {
      if (!['ENOTEMPTY', 'ENOENT'].includes((error as NodeJS.ErrnoException).code || '')) throw error
    }
  }))
}

export async function planProjectExport(
  options: ProjectContextOptions = {},
  state?: ProjectExportState,
): Promise<ProjectExportPlan> {
  const projectDirectory = path.resolve(options.projectDirectory ?? process.cwd())
  const project = createProjectContext(options)
  const info = await project.getInfo()
  const config = state?.config ?? info.config
  const bundle = state?.bundle ?? info.bundle

  if (!config) {
    throw new Error('Could not find i18n.config.json. Pass --config with the project configuration path.')
  }
  if (!bundle) {
    throw new Error(`Could not find the bundle at ${info.bundlePath}. Run the bundle command first or pass --file.`)
  }

  const exportFiles = buildExportPlan(bundle, config)
  const owners = buildTranslationOwners(bundle, config)
  const managedDirectoryPaths = owners.map((owner) => {
    return normalizeProjectPath(`${owner.directory}/${config.translationsDirectory}`)
  })
  const managedDirectories = managedDirectoryPaths.map((directory) => assertInsideProject(projectDirectory, directory))
  const plannedPaths = new Set(exportFiles.map((file) => normalizeProjectPath(file.path)))
  const existingInterfaceNames: Record<string, string> = {}
  const existingPropertyTypes: Record<string, string> = {}
  const existingTypeImports: Record<string, Array<{ name: string; path: string }>> = {}
  const baseContents = new Map<string, string | null>()
  await Promise.all(exportFiles.filter((file) => file.kind === 'base').map(async (file) => {
    const content = await readOptionalFile(assertInsideProject(projectDirectory, file.path))
    baseContents.set(file.path, content)
    const name = readInterfaceName(content)
    if (name) existingInterfaceNames[file.path] = name
  }))

  owners.forEach((owner) => {
    const expectedPath = `${owner.directory}/${config.translationsDirectory}/base.ts`.replaceAll(/\/+/g, '/')
    const baseFile = exportFiles.find((file) => file.kind === 'base' && file.path === expectedPath)
    if (!baseFile) return
    const content = baseContents.get(baseFile.path) || null
    const imports = readTypeImports(content)
    const obsoleteTypeNames = new Set<string>()
    existingTypeImports[baseFile.path] = imports.filter((item) => {
      const targetPath = resolveTypeImportPath(baseFile.path, item.path, config)
      if (!targetPath) return true
      if (plannedPaths.has(targetPath)) return false
      if (managedDirectoryPaths.some((directory) => isInsideDirectory(targetPath, directory))) {
        obsoleteTypeNames.add(item.name)
        return false
      }
      return true
    })
    const propertyTypes = readPropertyTypes(content, owner.keyPath)
    Object.entries(propertyTypes).forEach(([key, type]) => {
      const usesObsoleteType = [...obsoleteTypeNames].some((name) => new RegExp(`\\b${name}\\b`).test(type))
      if (!usesObsoleteType) existingPropertyTypes[key] = type
    })
  })

  const catalogFile = info.catalogPath
    ? path.relative(projectDirectory, info.catalogPath).replaceAll(path.sep, '/')
    : config.catalogFile
  const existingCatalog = catalogFile
    ? await readOptionalFile(assertInsideProject(projectDirectory, catalogFile))
    : null
  const generatedFiles = generateSourceFiles(bundle, config, {
    catalogFile,
    existingInterfaceNames,
    existingPropertyTypes,
    existingTypeImports,
    existingLanguageTypeName: readLanguageTypeName(existingCatalog) || undefined,
  })

  const generatedChanges = await Promise.all(generatedFiles.map(async (file): Promise<ProjectExportChange> => {
    const absolutePath = assertInsideProject(projectDirectory, file.path)
    const existing = await readOptionalFile(absolutePath)
    const status = existing === null ? 'create' : existing === file.content ? 'unchanged' : 'modify'
    return {
      ...file,
      absolutePath,
      status,
      diff: status === 'unchanged'
        ? undefined
        : createTwoFilesPatch(
          file.path,
          file.path,
          existing ?? '',
          file.content,
          existing === null ? 'missing' : 'current',
          'generated',
          { context: 3 },
        ),
    }
  }))

  const generatedAbsolutePaths = new Set(generatedChanges.map((change) => change.absolutePath))
  const existingManagedFiles = config.deletion === false
    ? []
    : (await Promise.all(managedDirectories.map(listManagedFiles))).flat()
  const deletedChanges: ProjectExportChange[] = [...new Set(existingManagedFiles)]
    .filter((filePath) => !generatedAbsolutePaths.has(filePath))
    .filter((filePath) => config.deletion !== false && !isIgnoredDeletionFile(filePath, config.deletion))
    .map((absolutePath) => ({
      kind: 'obsolete',
      path: normalizeProjectPath(path.relative(projectDirectory, absolutePath)),
      absolutePath,
      status: 'delete',
    }))

  const changes = [...generatedChanges, ...deletedChanges]
    .sort((left, right) => left.path.localeCompare(right.path))
  return { projectDirectory, bundlePath: info.bundlePath, changes, managedDirectories, deletion: config.deletion }
}

export async function applyProjectExport(
  plan: ProjectExportPlan,
  options: { deleteObsolete?: boolean } = {},
): Promise<void> {
  for (const change of plan.changes.filter((item) => item.status !== 'delete')) {
    if (change.status === 'unchanged' || change.content === undefined) continue
    await fs.mkdir(path.dirname(change.absolutePath), { recursive: true })
    const temporaryPath = `${change.absolutePath}.i18n-editor-${process.pid}.tmp`
    try {
      await fs.writeFile(temporaryPath, change.content, 'utf8')
      await fs.rename(temporaryPath, change.absolutePath)
    } catch (error) {
      await fs.rm(temporaryPath, { force: true })
      throw error
    }
  }
  const shouldDelete = plan.deletion !== false
    && (plan.deletion.autoDelete || options.deleteObsolete === true)
  if (shouldDelete) {
    for (const change of plan.changes.filter((item) => item.status === 'delete')) {
      await fs.rm(change.absolutePath, { force: true, recursive: true })
    }
    await Promise.all(plan.managedDirectories.map(removeEmptyDescendants))
  }
}
