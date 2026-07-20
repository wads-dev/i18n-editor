#!/usr/bin/env node

import { createInterface } from 'node:readline/promises'
import { createRequire } from 'node:module'

import { Command, InvalidArgumentError } from 'commander'

import { createServer } from '../server/createServer.js'
import { applyProjectExport, planProjectExport, type ProjectExportPlan } from '../server/exportProject.js'
import { createProjectContext } from '../server/projectContext.js'
import { analyzeTranslationUsageCached } from '../server/usageAnalysis.js'
import type { TranslationUsageReport } from '../core/projectApi.js'

type CommonOptions = {
  project: string
  config?: string
  input?: string
}

type ServerOptions = {
  host: string
  port: number
  bundle?: string
}

type BundleOptions = {
  output: string
}

type ExportOptions = {
  file: string
  yes?: boolean
  delete?: boolean
  diff: boolean
}

type UsageOptions = {
  file: string
  json?: boolean
  failOnUnreferenced?: boolean
  refresh?: boolean
}

function parsePort(value: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new InvalidArgumentError('Port must be an integer between 0 and 65535.')
  }
  return port
}

function getProjectOptions(command: Command, bundleFile?: string) {
  const options = command.optsWithGlobals<CommonOptions>()
  return {
    projectDirectory: options.project,
    configFile: options.config,
    catalogFile: options.input,
    bundleFile,
  }
}

function printExportPlan(plan: ProjectExportPlan, showDiff: boolean): { writeCount: number, deletionCount: number } {
  const created = plan.changes.filter((change) => change.status === 'create').length
  const modified = plan.changes.filter((change) => change.status === 'modify').length
  const unchanged = plan.changes.filter((change) => change.status === 'unchanged').length
  const deleted = plan.changes.filter((change) => change.status === 'delete').length

  console.log(`Export plan from ${plan.bundlePath}`)
  printPreview(plan, showDiff)
  console.log(`${created} files to create, ${modified} to overwrite, ${deleted} to delete, ${unchanged} unchanged.`)
  return { writeCount: created + modified, deletionCount: deleted }
}

function colorize(value: string, color: 'green' | 'red' | 'yellow'): string {
  if (!process.stdout.isTTY) return value
  const code = color === 'green' ? 32 : color === 'red' ? 31 : 33
  return `\u001B[${code}m${value}\u001B[0m`
}

function colorizeDiff(diff: string): string {
  if (!process.stdout.isTTY) return diff
  return diff.split('\n').map((line) => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      return colorize(line, 'yellow')
    }
    if (line.startsWith('+')) return colorize(line, 'green')
    if (line.startsWith('-')) return colorize(line, 'red')
    return line
  }).join('\n')
}

function printPreview(plan: ProjectExportPlan, showDiff: boolean): void {
  plan.changes.forEach((change) => {
    if (change.status === 'create') console.log(colorize(`+ new       ${change.path}`, 'green'))
    else if (change.status === 'delete') console.log(colorize(`- delete    ${change.path}`, 'red'))
    else if (change.status === 'modify') console.log(colorize(`~ modified  ${change.path}`, 'yellow'))
    else console.log(`  unchanged ${change.path}`)
  })

  const deletionCount = plan.changes.filter((change) => change.status === 'delete').length
  if (deletionCount > 0) {
    const warning = plan.deletion !== false && plan.deletion.autoDelete
      ? `Warning: ${deletionCount} divergent file${deletionCount === 1 ? '' : 's'} will be deleted during export because deletion.autoDelete is enabled.`
      : `Warning: ${deletionCount} deletion candidate${deletionCount === 1 ? '' : 's'} detected. They will be preserved unless export runs with --delete.`
    console.log(`\n${colorize(warning, 'yellow')}`)
  }

  if (!showDiff) return
  plan.changes.forEach((change) => {
    if (!change.diff || change.status === 'delete') return
    console.log(`\n${colorize(`diff ${change.path}`, 'yellow')}`)
    process.stdout.write(colorizeDiff(change.diff))
  })
}

async function confirmExport(deletionCount: number): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Confirmation requires an interactive terminal. Re-run with --yes to apply non-interactively.')
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const deletionMessage = deletionCount > 0 ? ` and delete ${deletionCount} divergent file${deletionCount === 1 ? '' : 's'}` : ''
    const answer = await prompt.question(`Apply this export plan${deletionMessage}? [y/N] `)
    return /^(y|yes)$/i.test(answer.trim())
  } finally {
    prompt.close()
  }
}

async function generateBundle(command: Command, output: string): Promise<void> {
  const projectOptions = getProjectOptions(command, output)
  const result = await createProjectContext(projectOptions).generateBundle()
  console.log(`i18n bundle created at ${result.bundlePath}`)
  console.log(`${Object.keys(result.bundle.languages).length} languages exported.`)
}

async function exportBundle(command: Command, options: ExportOptions): Promise<void> {
  const plan = await planProjectExport(getProjectOptions(command, options.file))
  const { writeCount, deletionCount } = printExportPlan(plan, options.diff)
  const deleteObsolete = plan.deletion !== false
    && (plan.deletion.autoDelete || options.delete === true)
  const appliedDeletionCount = deleteObsolete ? deletionCount : 0
  const changeCount = writeCount + appliedDeletionCount
  if (changeCount === 0) {
    if (deletionCount > 0) {
      console.log('No files were changed. Deletion candidates were preserved; re-run with --delete to remove them.')
      return
    }
    console.log('The project already matches the bundle.')
    return
  }
  if (!options.yes && !await confirmExport(appliedDeletionCount)) {
    console.log('Export cancelled. No files were changed.')
    return
  }
  await applyProjectExport(plan, { deleteObsolete })
  console.log(`${writeCount} files written, ${appliedDeletionCount} deleted.`)
}

function printUsageReport(report: TranslationUsageReport): void {
  Object.entries(report.entries).forEach(([key, usage]) => {
    const status = usage.status === 'used'
      ? colorize('used        ', 'green')
      : usage.status === 'uncertain'
        ? colorize('uncertain   ', 'yellow')
        : colorize('unreferenced', 'red')
    console.log(`${status}  ${String(usage.referenceCount).padStart(3)} refs  ${String(usage.fileCount).padStart(3)} files  ${key}`)
    usage.references.forEach((reference) => {
      console.log(`                ${reference.file}:${reference.line}:${reference.column}`)
    })
    if (usage.status === 'uncertain') usage.uncertainReferences.forEach((reference) => {
      console.log(`                ? ${reference.file}:${reference.line}:${reference.column}`)
    })
  })
  const values = Object.values(report.entries)
  const used = values.filter(({ status }) => status === 'used').length
  const uncertain = values.filter(({ status }) => status === 'uncertain').length
  const unreferenced = values.filter(({ status }) => status === 'unreferenced').length
  console.log(`\n${values.length} keys analyzed across ${report.sourceFileCount} source files: ${used} used, ${uncertain} uncertain, ${unreferenced} unreferenced.`)
}

async function analyzeUsage(command: Command, options: UsageOptions): Promise<void> {
  const projectOptions = getProjectOptions(command, options.file)
  const project = createProjectContext(projectOptions)
  const info = await project.getInfo()
  if (!info.config) throw new Error('Could not find i18n.config.json. Pass --config with the project configuration path.')
  if (!info.bundle) throw new Error(`Could not find the bundle at ${info.bundlePath}. Run the bundle command first or pass --file.`)
  const report = await analyzeTranslationUsageCached({
    projectDirectory: project.projectDirectory,
    bundle: info.bundle,
    config: info.config,
  }, options.refresh === true)
  if (options.json) console.log(JSON.stringify(report, null, 2))
  else printUsageReport(report)
  if (options.failOnUnreferenced
    && Object.values(report.entries).some(({ status }) => status === 'unreferenced')) {
    process.exitCode = 1
  }
}

function createProgram(): Command {
  const packageJson = createRequire(import.meta.url)('../../package.json') as { version: string }
  const program = new Command()

  program
    .name('i18n-edit')
    .description('Inspect, edit, bundle and regenerate typed i18n projects. Starts the web editor when no command is provided.')
    .version(packageJson.version)
    .showHelpAfterError()
    .showSuggestionAfterError()
    .configureHelp({ showGlobalOptions: true })
    .option('--project <path>', 'project root', process.cwd())
    .option('--config <path>', 'project configuration (default: i18n.config.json)')
    .option('--input <path>', 'TypeScript catalog that exports Langs')

  program
    .command('serve', { isDefault: true })
    .description('start the local web editor')
    .option('--bundle <path>', 'bundle served by the project API')
    .option('--host <host>', 'host used by the web editor', '127.0.0.1')
    .option('--port <port>', 'port used by the web editor', parsePort, 4173)
    .action(async (options: ServerOptions, command: Command) => {
      const server = await createServer(getProjectOptions(command, options.bundle))
      const address = await server.listen({ host: options.host, port: options.port })
      console.log(`i18n editor running at ${address}`)
    })

  program
    .command('bundle')
    .description('generate a portable translation bundle')
    .option('-o, --output <path>', 'output bundle path', 'i18n.bundle.json')
    .action(async (options: BundleOptions, command: Command) => {
      await generateBundle(command, options.output)
    })

  program
    .command('preview')
    .description('show the files that would be generated from a bundle')
    .option('-f, --file <path>', 'input bundle path', 'i18n.bundle.json')
    .option('--no-diff', 'hide generated content diffs')
    .action(async (options: { file: string, diff: boolean }, command: Command) => {
      printPreview(await planProjectExport(getProjectOptions(command, options.file)), options.diff)
    })

  program
    .command('export')
    .description('regenerate project translation files from a bundle')
    .option('-f, --file <path>', 'input bundle path', 'i18n.bundle.json')
    .option('-y, --yes', 'apply the plan without confirmation')
    .option('--delete', 'delete divergent files reported by the plan')
    .option('--no-diff', 'hide generated content diffs')
    .action(async (options: ExportOptions, command: Command) => {
      await exportBundle(command, options)
    })

  program
    .command('sync')
    .description('bundle the project, then regenerate its translation files')
    .option('-o, --output <path>', 'bundle path used between the two operations', 'i18n.bundle.json')
    .option('-y, --yes', 'apply the export plan without confirmation')
    .option('--delete', 'delete divergent files reported by the plan')
    .option('--no-diff', 'hide generated content diffs')
    .action(async (options: BundleOptions & Omit<ExportOptions, 'file'>, command: Command) => {
      await generateBundle(command, options.output)
      await exportBundle(command, { ...options, file: options.output })
    })

  program
    .command('usage')
    .description('analyze static references to every translation key')
    .option('-f, --file <path>', 'input bundle path', 'i18n.bundle.json')
    .option('--json', 'print the usage report as JSON')
    .option('--refresh', 'ignore the disk cache and rebuild the usage report')
    .option('--fail-on-unreferenced', 'exit with code 1 when a key has no static references')
    .action(async (options: UsageOptions, command: Command) => {
      await analyzeUsage(command, options)
    })

  return program
}

try {
  await createProgram().parseAsync(process.argv)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
