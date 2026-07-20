import { assertBundle } from '@wads.dev/i18n-ts/bundle'

import { normalizeEditorProjectConfig } from '../core/projectConfig.js'
import type {
  ApiError,
  GenerateBundleResult,
  ProjectExportPreviewResult,
  ProjectExportResult,
  ProjectInfo,
  TranslationUsageResponse,
} from '../core/projectApi.js'

async function readResponse<T>(response: Response): Promise<T> {
  const value = await response.json() as T | ApiError
  if (!response.ok) {
    throw new Error('error' in (value as ApiError) ? (value as ApiError).error : `Request failed with status ${response.status}.`)
  }
  return value as T
}

export async function getProjectInfo(): Promise<ProjectInfo> {
  const info = await readResponse<ProjectInfo>(await fetch('/api/project', { cache: 'no-store' }))
  return {
    ...info,
    config: info.config ? normalizeEditorProjectConfig(info.config) : null,
    bundle: info.bundle ? assertBundle(info.bundle) : null,
  }
}

export async function generateProjectBundle(): Promise<GenerateBundleResult> {
  const result = await readResponse<GenerateBundleResult>(await fetch('/api/bundle', { method: 'POST' }))
  return { ...result, bundle: assertBundle(result.bundle) }
}

export async function checkProjectExport(bundle, config): Promise<ProjectExportPreviewResult> {
  return readResponse<ProjectExportPreviewResult>(await fetch('/api/export-preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bundle, config }),
  }))
}

export async function exportProject(bundle, config, deleteObsolete = false): Promise<ProjectExportResult> {
  return readResponse<ProjectExportResult>(await fetch('/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bundle, config, deleteObsolete }),
  }))
}

export async function analyzeProjectUsage(bundle, config, wait = false): Promise<TranslationUsageResponse> {
  return readResponse<TranslationUsageResponse>(await fetch('/api/usage-analysis', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bundle, config, wait }),
  }))
}
