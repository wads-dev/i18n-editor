import type { I18nBundle } from '@wads.dev/i18n-ts/bundle'
import type { EditorProjectConfig } from './projectConfig.js'

export type ProjectInfo = {
  projectDirectory: string
  configPath: string | null
  catalogPath: string | null
  bundlePath: string
  config: EditorProjectConfig | null
  bundle: I18nBundle | null
  canGenerateBundle: boolean
}

export type GenerateBundleResult = {
  bundle: I18nBundle
  bundlePath: string
}

export type ProjectExportPreviewRequest = {
  bundle: I18nBundle
  config: EditorProjectConfig
}

export type ProjectExportRequest = ProjectExportPreviewRequest & {
  deleteObsolete?: boolean
}

export type ProjectExportPreviewChange = {
  kind: 'base' | 'index' | 'language' | 'obsolete'
  path: string
  status: 'create' | 'modify' | 'unchanged' | 'delete'
  diff?: string
}

export type ProjectExportPreviewResult = {
  changes: ProjectExportPreviewChange[]
}

export type ProjectExportResult = ProjectExportPreviewResult & {
  written: number
  deleted: number
  preserved: number
}

export type TranslationUsageReference = {
  file: string
  line: number
  column: number
}

export type TranslationUsageEntry = {
  status: 'used' | 'unreferenced' | 'uncertain'
  referenceCount: number
  uncertainReferenceCount: number
  fileCount: number
  references: TranslationUsageReference[]
  uncertainReferences: TranslationUsageReference[]
}

export type TranslationUsageReport = {
  analyzedAt: number
  sourceFileCount: number
  entries: Record<string, TranslationUsageEntry>
}

export type TranslationUsageRequest = ProjectExportPreviewRequest & {
  wait?: boolean
}

export type TranslationUsageResponse = {
  cacheStatus: 'missing' | 'verified' | 'unverified'
  report: TranslationUsageReport | null
}

export type ApiError = {
  error: string
}
