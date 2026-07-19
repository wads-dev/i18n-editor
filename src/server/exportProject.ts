import fs from 'node:fs/promises'
import path from 'node:path'

import { buildExportPlan } from '../core/exportPlan.js'
import { generateSourceFiles, type GeneratedSourceFile } from '../core/sourceFiles.js'
import { createProjectContext, type ProjectContextOptions } from './projectContext.js'

export type ProjectExportChange = GeneratedSourceFile & {
  absolutePath: string
  status: 'create' | 'modify' | 'unchanged'
}

export type ProjectExportPlan = {
  projectDirectory: string
  bundlePath: string
  changes: ProjectExportChange[]
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

export async function planProjectExport(options: ProjectContextOptions = {}): Promise<ProjectExportPlan> {
  const projectDirectory = path.resolve(options.projectDirectory ?? process.cwd())
  const project = createProjectContext(options)
  const info = await project.getInfo()

  if (!info.config) {
    throw new Error('Could not find i18n.config.json. Pass --config with the project configuration path.')
  }
  if (!info.bundle) {
    throw new Error(`Could not find the bundle at ${info.bundlePath}. Run the bundle command first or pass --file.`)
  }

  const exportFiles = buildExportPlan(info.bundle, info.config)
  const existingInterfaceNames: Record<string, string> = {}
  await Promise.all(exportFiles.filter((file) => file.kind === 'base').map(async (file) => {
    const content = await readOptionalFile(assertInsideProject(projectDirectory, file.path))
    const name = readInterfaceName(content)
    if (name) existingInterfaceNames[file.path] = name
  }))

  const catalogFile = info.catalogPath
    ? path.relative(projectDirectory, info.catalogPath).replaceAll(path.sep, '/')
    : (info.config as typeof info.config & { catalogFile?: string }).catalogFile
  const existingCatalog = catalogFile
    ? await readOptionalFile(assertInsideProject(projectDirectory, catalogFile))
    : null
  const generatedFiles = generateSourceFiles(info.bundle, info.config, {
    catalogFile,
    existingInterfaceNames,
    existingLanguageTypeName: readLanguageTypeName(existingCatalog) || undefined,
  })

  const changes = await Promise.all(generatedFiles.map(async (file): Promise<ProjectExportChange> => {
    const absolutePath = assertInsideProject(projectDirectory, file.path)
    const existing = await readOptionalFile(absolutePath)
    return {
      ...file,
      absolutePath,
      status: existing === null ? 'create' : existing === file.content ? 'unchanged' : 'modify',
    }
  }))

  return { projectDirectory, bundlePath: info.bundlePath, changes }
}

export async function applyProjectExport(plan: ProjectExportPlan): Promise<void> {
  for (const change of plan.changes) {
    if (change.status === 'unchanged') continue
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
}
