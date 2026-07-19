import type { I18nBundle } from '@wads.dev/i18n-ts/bundle'
import type { I18nProjectConfig } from '@wads.dev/i18n-ts/config'

export type ProjectInfo = {
  projectDirectory: string
  configPath: string | null
  catalogPath: string | null
  bundlePath: string
  config: I18nProjectConfig | null
  bundle: I18nBundle | null
  canGenerateBundle: boolean
}

export type GenerateBundleResult = {
  bundle: I18nBundle
  bundlePath: string
}

export type ProjectExportPreviewRequest = {
  bundle: I18nBundle
  config: I18nProjectConfig
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
