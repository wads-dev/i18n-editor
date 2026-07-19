#!/usr/bin/env node

import { createInterface } from 'node:readline/promises'
import { createRequire } from 'node:module'

import { Command, InvalidArgumentError } from 'commander'

import { createServer } from '../server/createServer.js'
import { applyProjectExport, planProjectExport, type ProjectExportPlan } from '../server/exportProject.js'
import { createProjectContext } from '../server/projectContext.js'

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

function printExportPlan(plan: ProjectExportPlan, showDiff: boolean): number {
  const changed = plan.changes.filter((change) => change.status !== 'unchanged')
  const created = plan.changes.filter((change) => change.status === 'create').length
  const modified = plan.changes.filter((change) => change.status === 'modify').length
  const unchanged = plan.changes.filter((change) => change.status === 'unchanged').length
  const deleted = plan.changes.filter((change) => change.status === 'delete').length

  console.log(`Export plan from ${plan.bundlePath}`)
  printPreview(plan, showDiff)
  console.log(`${created} files to create, ${modified} to overwrite, ${deleted} to delete, ${unchanged} unchanged.`)
  return changed.length
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

  if (!showDiff) return
  plan.changes.forEach((change) => {
    if (!change.diff || change.status === 'delete') return
    console.log(`\n${colorize(`diff ${change.path}`, 'yellow')}`)
    process.stdout.write(colorizeDiff(change.diff))
  })
}

async function confirmExport(): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Confirmation requires an interactive terminal. Re-run with --yes to apply non-interactively.')
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await prompt.question('Apply this export plan and overwrite the listed files? [y/N] ')
    return /^(y|yes)$/i.test(answer.trim())
  } finally {
    prompt.close()
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
    .action(async (options: { output: string }, command: Command) => {
      const projectOptions = getProjectOptions(command, options.output)
      const result = await createProjectContext(projectOptions).generateBundle()
      console.log(`i18n bundle created at ${result.bundlePath}`)
      console.log(`${Object.keys(result.bundle.languages).length} languages exported.`)
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
    .option('--no-diff', 'hide generated content diffs')
    .action(async (options: { file: string, yes?: boolean, diff: boolean }, command: Command) => {
      const plan = await planProjectExport(getProjectOptions(command, options.file))
      const changeCount = printExportPlan(plan, options.diff)
      if (changeCount === 0) {
        console.log('The project already matches the bundle.')
        return
      }
      if (!options.yes && !await confirmExport()) {
        console.log('Export cancelled. No files were changed.')
        return
      }
      await applyProjectExport(plan)
      console.log(`${changeCount} files written.`)
    })

  return program
}

try {
  await createProgram().parseAsync(process.argv)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
