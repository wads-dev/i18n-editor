import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseBundle } from '@wads.dev/i18n-ts/bundle'
import {
  PROJECT_CONFIG_FORMAT,
  PROJECT_CONFIG_VERSION,
} from '@wads.dev/i18n-ts/config'

import { normalizeEditorProjectConfig, type EditorProjectConfig } from '../core/projectConfig.js'
import type { GenerateBundleResult, ProjectInfo } from '../core/projectApi.js'

export type ProjectContextOptions = {
  projectDirectory?: string
  configFile?: string
  catalogFile?: string
  bundleFile?: string
}

type ProjectConfigWithCatalog = EditorProjectConfig & { catalogFile: string }

const DEFAULT_CATALOG_CANDIDATES = [
  'src/shared/i18n/index.ts',
  'src/shared/i18n/translations/index.ts',
  'src/i18n/index.ts',
  'src/translations/index.ts',
]

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile()
  } catch {
    return false
  }
}

function resolveFromProject(projectDirectory: string, filePath: string): string {
  return path.resolve(projectDirectory, filePath)
}

async function readConfig(configPath: string): Promise<ProjectConfigWithCatalog | null> {
  if (!await isFile(configPath)) return null

  const raw = JSON.parse(await fs.readFile(configPath, 'utf8')) as Record<string, unknown>
  if (raw.format !== PROJECT_CONFIG_FORMAT || raw.version !== PROJECT_CONFIG_VERSION) {
    throw new Error(`Invalid project configuration. Expected ${PROJECT_CONFIG_FORMAT} version ${PROJECT_CONFIG_VERSION}.`)
  }

  const config = normalizeEditorProjectConfig(raw)
  const catalogFile = typeof raw.catalogFile === 'string' && raw.catalogFile.trim()
    ? raw.catalogFile.trim()
    : 'src/shared/i18n/index.ts'

  return { ...config, catalogFile }
}

async function readBundle(bundlePath: string) {
  if (!await isFile(bundlePath)) return null
  return parseBundle(await fs.readFile(bundlePath, 'utf8'))
}

async function findCatalogPath(
  projectDirectory: string,
  explicitCatalogFile: string | undefined,
  config: ProjectConfigWithCatalog | null,
): Promise<string | null> {
  const candidates = [
    explicitCatalogFile,
    config?.catalogFile,
    ...DEFAULT_CATALOG_CANDIDATES,
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    const resolved = resolveFromProject(projectDirectory, candidate)
    if (await isFile(resolved)) return resolved
  }

  return null
}

function getBundlerCliPath(): string {
  const runtimeEntry = fileURLToPath(import.meta.resolve('@wads.dev/i18n-ts'))
  return path.resolve(path.dirname(runtimeEntry), '../cli/exportBundle.js')
}

async function runBundler(projectDirectory: string, catalogPath: string, bundlePath: string): Promise<void> {
  const bundlerCliPath = getBundlerCliPath()

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [
      bundlerCliPath,
      '--input', catalogPath,
      '--output', bundlePath,
    ], {
      cwd: projectDirectory,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `The bundle generator exited with code ${String(code)}.`))
    })
  })
}

export function createProjectContext(options: ProjectContextOptions = {}) {
  const projectDirectory = path.resolve(options.projectDirectory ?? process.cwd())
  const configPath = resolveFromProject(projectDirectory, options.configFile ?? 'i18n.config.json')
  const bundlePath = resolveFromProject(projectDirectory, options.bundleFile ?? 'i18n.bundle.json')
  let generation: Promise<GenerateBundleResult> | null = null

  async function getInfo(): Promise<ProjectInfo> {
    const config = await readConfig(configPath)
    const catalogPath = await findCatalogPath(projectDirectory, options.catalogFile, config)

    return {
      projectDirectory,
      configPath: config ? configPath : null,
      catalogPath,
      bundlePath,
      config,
      bundle: await readBundle(bundlePath),
      canGenerateBundle: catalogPath !== null,
    }
  }

  async function generateBundle(): Promise<GenerateBundleResult> {
    if (generation) return generation

    generation = (async () => {
      const info = await getInfo()
      if (!info.catalogPath) {
        throw new Error('Could not find the TypeScript catalog. Set catalogFile in i18n.config.json or pass --input to the Editor.')
      }

      await runBundler(projectDirectory, info.catalogPath, bundlePath)
      const bundle = await readBundle(bundlePath)
      if (!bundle) throw new Error('The bundle generator finished without creating the bundle file.')
      return { bundle, bundlePath }
    })().finally(() => {
      generation = null
    })

    return generation
  }

  return { projectDirectory, getInfo, generateBundle }
}
