import fastifyStatic from '@fastify/static'
import { assertBundle } from '@wads.dev/i18n-ts/bundle'
import Fastify, { type FastifyInstance } from 'fastify'
import { fileURLToPath } from 'node:url'

import type {
  ApiError,
  GenerateBundleResult,
  ProjectExportRequest,
  ProjectExportResult,
  ProjectExportPreviewRequest,
  ProjectExportPreviewResult,
  ProjectInfo,
  TranslationUsageReport,
  TranslationUsageRequest,
} from '../core/projectApi.js'
import { normalizeEditorProjectConfig } from '../core/projectConfig.js'
import { applyProjectExport, planProjectExport } from './exportProject.js'
import { createProjectContext, type ProjectContextOptions } from './projectContext.js'
import { analyzeTranslationUsage } from './usageAnalysis.js'

export async function createServer(options: ProjectContextOptions = {}): Promise<FastifyInstance> {
  const server = Fastify({ logger: false })
  const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url))
  const project = createProjectContext(options)
  let exportQueue: Promise<unknown> = Promise.resolve()

  server.get<{ Reply: ProjectInfo | ApiError }>('/api/project', async (_request, reply) => {
    try {
      return await project.getInfo()
    } catch (error) {
      return reply.code(500).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  server.post<{ Reply: GenerateBundleResult | ApiError }>('/api/bundle', async (_request, reply) => {
    try {
      return await project.generateBundle()
    } catch (error) {
      return reply.code(500).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  server.post<{
    Body: ProjectExportPreviewRequest
    Reply: ProjectExportPreviewResult | ApiError
  }>('/api/export-preview', { bodyLimit: 20 * 1024 * 1024 }, async (request, reply) => {
    try {
      const plan = await planProjectExport(options, {
        bundle: assertBundle(request.body?.bundle),
        config: normalizeEditorProjectConfig(request.body?.config),
      })
      return {
        changes: plan.changes.map(({ kind, path, status, diff }) => ({ kind, path, status, diff })),
      }
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  server.post<{
    Body: TranslationUsageRequest
    Reply: TranslationUsageReport | ApiError
  }>('/api/usage-analysis', { bodyLimit: 20 * 1024 * 1024 }, async (request, reply) => {
    try {
      return analyzeTranslationUsage({
        projectDirectory: project.projectDirectory,
        bundle: assertBundle(request.body?.bundle),
        config: normalizeEditorProjectConfig(request.body?.config),
      })
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  server.post<{
    Body: ProjectExportRequest
    Reply: ProjectExportResult | ApiError
  }>('/api/export', { bodyLimit: 20 * 1024 * 1024 }, async (request, reply) => {
    try {
      const bundle = assertBundle(request.body?.bundle)
      const config = normalizeEditorProjectConfig(request.body?.config)
      const deleteObsolete = request.body?.deleteObsolete === true
      const exportTask = exportQueue.catch(() => undefined).then(async () => {
        const plan = await planProjectExport(options, { bundle, config })
        const result = await applyProjectExport(plan, { deleteObsolete })
        return {
          changes: plan.changes.map(({ kind, path, status, diff }) => ({ kind, path, status, diff })),
          ...result,
        }
      })
      exportQueue = exportTask
      return await exportTask
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  await server.register(fastifyStatic, {
    root: publicDirectory,
    prefix: '/',
  })

  return server
}
