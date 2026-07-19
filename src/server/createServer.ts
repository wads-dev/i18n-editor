import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { fileURLToPath } from 'node:url'

import type { ApiError, GenerateBundleResult, ProjectInfo } from '../core/projectApi.js'
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

  await server.register(fastifyStatic, {
    root: publicDirectory,
    prefix: '/',
  })

  return server
}
