import fastifyStatic from '@fastify/static'
import { assertBundle } from '@wads.dev/i18n-ts/bundle'
import Fastify, { type FastifyInstance } from 'fastify'
import { fileURLToPath } from 'node:url'

import type {
  ApiError,
  GenerateBundleResult,
  ProjectExportPreviewRequest,
  ProjectExportPreviewResult,
  ProjectInfo,
} from '../core/projectApi.js'
import { normalizeEditorProjectConfig } from '../core/projectConfig.js'
import { planProjectExport } from './exportProject.js'
import { createProjectContext, type ProjectContextOptions } from './projectContext.js'

export async function createServer(options: ProjectContextOptions = {}): Promise<FastifyInstance> {
  const server = Fastify({ logger: false })
  const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url))
  const project = createProjectContext(options)

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

  await server.register(fastifyStatic, {
    root: publicDirectory,
    prefix: '/',
  })

  return server
}
