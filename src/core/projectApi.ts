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

export type ProjectExportPreviewChange = {
  kind: 'base' | 'index' | 'language' | 'obsolete'
  path: string
  status: 'create' | 'modify' | 'unchanged' | 'delete'
  diff?: string
}

export type ProjectExportPreviewResult = {
  changes: ProjectExportPreviewChange[]
}

export type ApiError = {
  error: string
}
