import {
  createDefaultProjectConfig,
  normalizeProjectConfig,
  type I18nProjectConfig,
} from '@wads.dev/i18n-ts/config'

export type I18nDeletionConfig = {
  ignoredExtensions: string[]
  autoDelete: boolean
}

export type I18nExportConfig = {
  importAliases: Record<string, string>
  codeFormat: I18nCodeFormatConfig
}

export type I18nCodeFormatConfig = {
  useDoubleQuotes: boolean
  useSemicolons: boolean
  useShorthandProperties: boolean
  useTrailingCommas: boolean
  printWidth: number
  maxObjectInlineItems: number
  maxArrayInlineItems: number
  objectLayout: 'fit' | 'multiline'
  arrayLayout: 'fit' | 'multiline'
  indentation: {
    character: 'space' | 'tab'
    size: number
  }
}

export type EditorProjectConfig = Omit<I18nProjectConfig, 'deletion' | 'importAliases' | 'exportConfig'> & {
  catalogFile: string
  deletion: false | I18nDeletionConfig
  exportConfig: I18nExportConfig
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function normalizeCodeFormat(value: unknown, legacyExportConfig: Record<string, unknown>): I18nCodeFormatConfig {
  const input = isRecord(value) ? value : {}
  const indentation = isRecord(input.indentation) ? input.indentation : {}
  const indentationSize = Number.parseInt(String(indentation.size ?? 2), 10)
  const printWidth = Number.parseInt(String(input.printWidth ?? 120), 10)
  const maxObjectInlineItems = Number.parseInt(String(input.maxObjectInlineItems ?? 4), 10)
  const maxArrayInlineItems = Number.parseInt(String(input.maxArrayInlineItems ?? 8), 10)
  return {
    useDoubleQuotes: (input.useDoubleQuotes ?? legacyExportConfig.useDoubleQuotes) === true,
    useSemicolons: input.useSemicolons !== false,
    useShorthandProperties: input.useShorthandProperties !== false,
    useTrailingCommas: input.useTrailingCommas !== false,
    printWidth: Number.isFinite(printWidth) ? Math.min(400, Math.max(40, printWidth)) : 120,
    maxObjectInlineItems: Number.isFinite(maxObjectInlineItems) ? Math.min(100, Math.max(0, maxObjectInlineItems)) : 4,
    maxArrayInlineItems: Number.isFinite(maxArrayInlineItems) ? Math.min(100, Math.max(0, maxArrayInlineItems)) : 8,
    objectLayout: input.objectLayout === 'multiline' ? 'multiline' : 'fit',
    arrayLayout: input.arrayLayout === 'multiline' ? 'multiline' : 'fit',
    indentation: {
      character: indentation.character === 'tab' ? 'tab' : 'space',
      size: Number.isFinite(indentationSize) ? Math.min(8, Math.max(1, indentationSize)) : 2,
    },
  }
}

export function normalizeDeletionConfig(value: unknown): false | I18nDeletionConfig {
  if (value === false) return false
  const input = isRecord(value) ? value : {}
  const ignoredExtensions = Array.isArray(input.ignoredExtensions)
    ? [...new Set(input.ignoredExtensions
      .filter((extension): extension is string => typeof extension === 'string')
      .map((extension) => extension.trim().toLowerCase())
      .filter(Boolean)
      .map((extension) => extension.startsWith('.') ? extension : `.${extension}`))]
    : []
  return {
    ignoredExtensions,
    autoDelete: input.autoDelete === true,
  }
}

export function normalizeEditorProjectConfig(value: unknown): EditorProjectConfig {
  const input = isRecord(value) ? value : {}
  const exportInput = isRecord(input.exportConfig) ? input.exportConfig : {}
  const importAliases = normalizeStringRecord(exportInput.importAliases ?? input.importAliases)
  const normalized = normalizeProjectConfig({
    ...input,
    importAliases,
  } as Partial<I18nProjectConfig>)
  const normalizedRecord = normalized as unknown as Record<string, unknown>
  const normalizedExport = isRecord(normalizedRecord.exportConfig) ? normalizedRecord.exportConfig : {}
  const normalizedAliases = normalizeStringRecord(normalizedExport.importAliases ?? normalizedRecord.importAliases)
  const { importAliases: _legacyAliases, exportConfig: _normalizedExport, ...config } = normalizedRecord
  return {
    ...config as Omit<EditorProjectConfig, 'deletion' | 'exportConfig'>,
    catalogFile: typeof input.catalogFile === 'string' && input.catalogFile.trim()
      ? input.catalogFile.trim()
      : 'src/shared/i18n/index.ts',
    deletion: normalizeDeletionConfig(input.deletion),
    exportConfig: {
      importAliases: normalizedAliases,
      codeFormat: normalizeCodeFormat(exportInput.codeFormat, exportInput),
    },
  }
}

export function createDefaultEditorProjectConfig(): EditorProjectConfig {
  const defaults = createDefaultProjectConfig() as unknown as Record<string, unknown>
  const defaultsExport = isRecord(defaults.exportConfig) ? defaults.exportConfig : {}
  const importAliases = normalizeStringRecord(defaultsExport.importAliases ?? defaults.importAliases)
  const { importAliases: _legacyAliases, exportConfig: _defaultsExport, ...config } = defaults
  return {
    ...config as Omit<EditorProjectConfig, 'deletion' | 'exportConfig'>,
    catalogFile: 'src/shared/i18n/index.ts',
    deletion: normalizeDeletionConfig(undefined),
    exportConfig: {
      importAliases,
      codeFormat: normalizeCodeFormat(undefined, {}),
    },
  }
}

export function getEditorLevelName(config: EditorProjectConfig, level: number): string {
  if (level === 0) return 'Root'
  const names = config.levelNames.split(',').map((name) => name.trim()).filter(Boolean)
  return names[level - 1] || `Level ${level}`
}
