#!/usr/bin/env node

import { createInterface } from 'node:readline/promises'

import { createServer } from '../server/createServer.js'
import { applyProjectExport, planProjectExport, type ProjectExportPlan } from '../server/exportProject.js'
import { createProjectContext } from '../server/projectContext.js'

type CliCommand = 'serve' | 'bundle' | 'export'
type CliOptions = {
  command: CliCommand
  host: string
  port: number
  projectDirectory: string
  configFile?: string
  catalogFile?: string
  bundleFile?: string
  yes: boolean
  help: boolean
}

function parseArguments(arguments_: string[]): CliOptions {
  const remaining = [...arguments_]
  const first = remaining[0]
  const command: CliCommand = first === 'bundle' || first === 'export'
    ? remaining.shift() as CliCommand
    : 'serve'
  const options: CliOptions = {
    command,
    host: '127.0.0.1',
    port: 4173,
    projectDirectory: process.cwd(),
    yes: false,
    help: false,
  }

  for (let index = 0; index < remaining.length; index += 1) {
    const argument = remaining[index]
    const value = remaining[index + 1]

    if (argument === '--host' && value) {
      options.host = value
      index += 1
    } else if (argument === '--port' && value) {
      const port = Number.parseInt(value, 10)
      if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`Invalid port: ${value}`)
      options.port = port
      index += 1
    } else if (argument === '--project' && value) {
      options.projectDirectory = value
      index += 1
    } else if (argument === '--config' && value) {
      options.configFile = value
      index += 1
    } else if (argument === '--input' && value) {
      options.catalogFile = value
      index += 1
    } else if ((argument === '-o' || argument === '--output') && value && command === 'bundle') {
      options.bundleFile = value
      index += 1
    } else if ((argument === '-f' || argument === '--file') && value && command === 'export') {
      options.bundleFile = value
      index += 1
    } else if ((argument === '-y' || argument === '--yes') && command === 'export') {
      options.yes = true
    } else if (argument === '--help' || argument === '-h') {
      options.help = true
    } else {
      throw new Error(`Unknown, incomplete or misplaced argument: ${argument}`)
    }
  }

  return options
}

function printHelp(): void {
  console.log(`Usage: i18n-edit [command] [options]

Commands:
  bundle [-o <path>]  Generate a bundle (default: i18n.bundle.json)
  export [-f <path>]  Plan and regenerate project translation files from a bundle

Without a command, the Editor web server is started.

Common options:
  --project <path>    Project root (default: current directory)
  --config <path>     Project configuration (default: i18n.config.json)
  --input <path>      TypeScript catalog that exports Langs
  --help, -h          Show this help

Bundle options:
  --output, -o <path> Output bundle path (default: i18n.bundle.json)

Export options:
  --file, -f <path>   Input bundle path (default: i18n.bundle.json)
  --yes, -y           Apply the plan without confirmation

Server options:
  --host <host>       Host to bind (default: 127.0.0.1)
  --port <port>       Port to use (default: 4173)`)
}

function printExportPlan(plan: ProjectExportPlan): number {
  const changed = plan.changes.filter((change) => change.status !== 'unchanged')
  const created = plan.changes.filter((change) => change.status === 'create').length
  const modified = plan.changes.filter((change) => change.status === 'modify').length
  const unchanged = plan.changes.filter((change) => change.status === 'unchanged').length

  console.log(`Export plan from ${plan.bundlePath}`)
  plan.changes.forEach((change) => {
    console.log(`  ${change.status.padEnd(9)} ${change.path}`)
  })
  console.log(`${created} files to create, ${modified} to overwrite, ${unchanged} unchanged.`)
  return changed.length
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

async function run(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  const projectOptions = {
    projectDirectory: options.projectDirectory,
    configFile: options.configFile,
    catalogFile: options.catalogFile,
    bundleFile: options.bundleFile,
  }

  if (options.command === 'bundle') {
    const result = await createProjectContext(projectOptions).generateBundle()
    console.log(`i18n bundle created at ${result.bundlePath}`)
    console.log(`${Object.keys(result.bundle.languages).length} languages exported.`)
    return
  }

  if (options.command === 'export') {
    const plan = await planProjectExport(projectOptions)
    const changeCount = printExportPlan(plan)
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
    return
  }

  const server = await createServer(projectOptions)
  const address = await server.listen({ host: options.host, port: options.port })
  console.log(`i18n editor running at ${address}`)
}

try {
  await run()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
