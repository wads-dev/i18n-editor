import {
  loadStoredBundle,
  loadStoredProjectConfig,
  saveStoredBundle,
  saveStoredProjectConfig,
} from './bundle-storage.js'
import { moveKey } from '../core/moveKey.js'
import { removeKey } from '../core/removeKey.js'
import { createDefaultEditorProjectConfig, normalizeEditorProjectConfig } from '../core/projectConfig.js'
import { setStringValue } from '../core/setStringValue.js'
import { renderExportPreview } from './export-preview.js'
import { renderLevelImportFields } from './project-settings.js'
import { analyzeProjectUsage, checkProjectExport, exportProject, generateProjectBundle, getProjectInfo } from './project-api.js'
import { createEditorState } from './state.js'
import { createEditorView } from './view.js'
import type { ProjectExportPreviewChange, TranslationUsageReport } from '../core/projectApi.js'

const state = createEditorState()

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Required editor element not found: ${selector}`)
  return element
}

const elements = {
  emptyState: getElement<HTMLElement>('#empty-state'),
  feedback: getElement<HTMLElement>('#editor-feedback'),
  levelCount: getElement<HTMLInputElement>('#level-count'),
  levelNames: getElement<HTMLInputElement>('#level-names'),
  levelImports: getElement<HTMLElement>('#level-imports'),
  importAliases: getElement<HTMLTextAreaElement>('#import-aliases'),
  translationsDirectory: getElement<HTMLInputElement>('#translations-directory'),
  languageFileTemplate: getElement<HTMLInputElement>('#language-file-template'),
  languageReplacer: getElement<HTMLTextAreaElement>('#language-replacer'),
  useDoubleQuotes: getElement<HTMLInputElement>('#use-double-quotes'),
  useSemicolons: getElement<HTMLInputElement>('#use-semicolons'),
  useShorthandProperties: getElement<HTMLInputElement>('#use-shorthand-properties'),
  useTrailingCommas: getElement<HTMLInputElement>('#use-trailing-commas'),
  indentationCharacter: getElement<HTMLSelectElement>('#indentation-character'),
  indentationSize: getElement<HTMLInputElement>('#indentation-size'),
  printWidth: getElement<HTMLInputElement>('#print-width'),
  maxObjectInlineItems: getElement<HTMLInputElement>('#max-object-inline-items'),
  maxArrayInlineItems: getElement<HTMLInputElement>('#max-array-inline-items'),
  objectLayout: getElement<HTMLSelectElement>('#object-layout'),
  arrayLayout: getElement<HTMLSelectElement>('#array-layout'),
  deletionEnabled: getElement<HTMLInputElement>('#deletion-enabled'),
  ignoredDeletionExtensions: getElement<HTMLInputElement>('#ignored-deletion-extensions'),
  autoDelete: getElement<HTMLInputElement>('#auto-delete'),
  exportPreview: getElement<HTMLElement>('#export-preview'),
  exportPreviewFeedback: getElement<HTMLElement>('#export-preview-feedback'),
  checkExportDiffs: getElement<HTMLButtonElement>('#check-export-diffs'),
  exportProject: getElement<HTMLButtonElement>('#export-project'),
  exportDeleteObsolete: getElement<HTMLInputElement>('#export-delete-obsolete'),
  search: getElement<HTMLInputElement>('#translation-search'),
  summary: getElement<HTMLElement>('#bundle-summary'),
  settingsPanel: getElement<HTMLElement>('#settings-panel'),
  tableWrap: getElement<HTMLElement>('#table-wrap'),
  toggleSettingsPanel: getElement<HTMLButtonElement>('#toggle-settings-panel'),
  projectStatus: getElement<HTMLElement>('#project-status'),
  projectStatusText: getElement<HTMLElement>('#project-status-text'),
  retryProjectLoad: getElement<HTMLButtonElement>('#retry-project-load'),
  analyzeUsage: getElement<HTMLButtonElement>('#analyze-usage'),
  showUnreferenced: getElement<HTMLInputElement>('#show-unreferenced'),
  visualLevelCount: getElement<HTMLInputElement>('#visual-level-count'),
}

let settingsPanelVisible = false
let projectConfig = createDefaultEditorProjectConfig()
let checkedExportChanges: ProjectExportPreviewChange[] | null = null
let exportPreviewRequestVersion = 0
let visualLevelCountOverride: number | null = null
let currentUsageReport: TranslationUsageReport | null = null

function replaceUsageReport(report: TranslationUsageReport | null): void {
  currentUsageReport = report
  view.setUsageReport(report)
  elements.showUnreferenced.disabled = report === null
  if (report === null) {
    view.setShowUnreferenced(false)
    elements.showUnreferenced.checked = false
  }
}

function remapUsageKey(sourceKey: string, targetKey: string): void {
  if (!currentUsageReport) return
  const entries = Object.fromEntries(Object.entries(currentUsageReport.entries).map(([key, usage]) => {
    if (key === sourceKey) return [targetKey, usage]
    if (key.startsWith(`${sourceKey}.`) || key.startsWith(`${sourceKey}[`)) {
      return [`${targetKey}${key.slice(sourceKey.length)}`, usage]
    }
    return [key, usage]
  }))
  replaceUsageReport({ ...currentUsageReport, entries })
}

function removeUsageKey(keyToRemove: string): void {
  if (!currentUsageReport) return
  const entries = Object.fromEntries(Object.entries(currentUsageReport.entries).filter(([key]) => {
    return key !== keyToRemove
      && !key.startsWith(`${keyToRemove}.`)
      && !key.startsWith(`${keyToRemove}[`)
  }))
  replaceUsageReport({ ...currentUsageReport, entries })
}

function renderCurrentExportPreview() {
  renderExportPreview(elements.exportPreview, state.getBundle(), projectConfig, checkedExportChanges)
}

function invalidateExportPreview() {
  exportPreviewRequestVersion += 1
  checkedExportChanges = null
  elements.exportPreviewFeedback.textContent = ''
  elements.exportPreviewFeedback.classList.remove('error', 'warning')
  elements.checkExportDiffs.disabled = !state.getBundle()
  elements.exportProject.disabled = !state.getBundle()
  elements.checkExportDiffs.textContent = 'Check diffs'
  renderCurrentExportPreview()
}

function invalidateUsageAnalysis(message = ''): void {
  view.setUsageReport(currentUsageReport)
  elements.analyzeUsage.disabled = !state.getBundle()
  elements.analyzeUsage.textContent = currentUsageReport ? 'Update usages' : 'Analyze usages'
  if (message) setFeedback(message)
}

const view = createEditorView({
  emptyState: elements.emptyState,
  tableWrap: elements.tableWrap,
  tableContainer: elements.tableWrap,
  summary: elements.summary,
  search: elements.search,
  onMoveKey(sourceKey) {
    const targetKey = window.prompt('Move key to:', sourceKey)
    if (targetKey === null || targetKey.trim() === '' || targetKey === sourceKey) return

    try {
      state.update((bundle) => moveKey(bundle, { sourceKey, targetKey: targetKey.trim() }))
      remapUsageKey(sourceKey, targetKey.trim())
      setFeedback(`Key moved from ${sourceKey} to ${targetKey.trim()}.`)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error), true)
    }
  },
  onRemoveKey(key) {
    if (!window.confirm(`Remove key "${key}" from every language?\n\nThe change will remain in the in-memory bundle until you export it to the project.`)) return
    try {
      state.update((bundle) => removeKey(bundle, { key }))
      removeUsageKey(key)
      setFeedback(`Key ${key} removed from every language. Export to apply the change to the project.`)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error), true)
    }
  },
  onEditValue({ languageKey, key, value }) {
    try {
      state.update((bundle) => setStringValue(bundle, { languageKey, key, value }))
      setFeedback(`Translation ${languageKey}.${key} updated.`)
      return true
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error), true)
      return false
    }
  },
})

function setFeedback(message, isError = false) {
  elements.feedback.textContent = message
  elements.feedback.classList.toggle('error', isError)
}

function setSettingsPanelVisibility(visible) {
  settingsPanelVisible = visible
  elements.settingsPanel.hidden = !visible
  elements.toggleSettingsPanel.setAttribute('aria-expanded', String(visible))
  elements.toggleSettingsPanel.setAttribute(
    'aria-label',
    visible ? 'Hide settings' : 'Show settings',
  )
  elements.toggleSettingsPanel.title = elements.toggleSettingsPanel.getAttribute('aria-label')
}

let projectConfigQueue = Promise.resolve()

function parseJsonObject(value, fieldName) {
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object.`)
  }
  return parsed
}

function applyProjectConfig(nextConfig, persist = true, renderLevelImports = true, syncJsonFields = true) {
  projectConfig = normalizeEditorProjectConfig(nextConfig)
  elements.levelCount.value = String(projectConfig.levelCount)
  elements.levelNames.value = projectConfig.levelNames
  elements.translationsDirectory.value = projectConfig.translationsDirectory
  elements.languageFileTemplate.value = projectConfig.languageFileTemplate
  elements.deletionEnabled.checked = projectConfig.deletion !== false
  elements.ignoredDeletionExtensions.value = projectConfig.deletion === false
    ? ''
    : projectConfig.deletion.ignoredExtensions.join(', ')
  elements.ignoredDeletionExtensions.disabled = projectConfig.deletion === false
  elements.autoDelete.checked = projectConfig.deletion !== false && projectConfig.deletion.autoDelete
  elements.autoDelete.disabled = projectConfig.deletion === false
  elements.exportDeleteObsolete.disabled = projectConfig.deletion === false
    ? true
    : projectConfig.deletion.autoDelete
  elements.exportDeleteObsolete.checked = projectConfig.deletion !== false
    && projectConfig.deletion.autoDelete
  const codeFormat = projectConfig.exportConfig.codeFormat
  elements.useDoubleQuotes.checked = codeFormat.useDoubleQuotes
  elements.useSemicolons.checked = codeFormat.useSemicolons
  elements.useShorthandProperties.checked = codeFormat.useShorthandProperties
  elements.useTrailingCommas.checked = codeFormat.useTrailingCommas
  elements.indentationCharacter.value = codeFormat.indentation.character
  elements.indentationSize.value = String(codeFormat.indentation.size)
  elements.printWidth.value = String(codeFormat.printWidth)
  elements.maxObjectInlineItems.value = String(codeFormat.maxObjectInlineItems)
  elements.maxArrayInlineItems.value = String(codeFormat.maxArrayInlineItems)
  elements.objectLayout.value = codeFormat.objectLayout
  elements.arrayLayout.value = codeFormat.arrayLayout
  if (syncJsonFields) {
    elements.importAliases.value = JSON.stringify(projectConfig.exportConfig.importAliases, null, 2)
    elements.languageReplacer.value = JSON.stringify(projectConfig.languageReplacer, null, 2)
  }
  if (renderLevelImports) {
    renderLevelImportFields(elements.levelImports, projectConfig, (index, field, value) => {
      try {
        const levelImports = projectConfig.levelImports.map((item) => ({ ...item }))
        levelImports[index][field] = field === 'path'
          ? value
          : parseJsonObject(value, field === 'valueReplacer' ? 'Value replacer' : 'Full replacer')
        applyProjectConfig({ ...projectConfig, levelImports }, true, false)
        setFeedback('Configuration updated.')
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : String(error), true)
      }
    })
  }
  if (visualLevelCountOverride === null) elements.visualLevelCount.value = String(projectConfig.levelCount)
  view.setProjectConfig({
    ...projectConfig,
    levelCount: visualLevelCountOverride ?? projectConfig.levelCount,
  })
  invalidateUsageAnalysis()
  invalidateExportPreview()

  if (!persist) return
  projectConfigQueue = projectConfigQueue
    .catch(() => undefined)
    .then(() => saveStoredProjectConfig(projectConfig))
    .catch((error) => {
      setFeedback(`Could not save settings: ${error instanceof Error ? error.message : String(error)}`, true)
    })
}

let persistenceQueue = Promise.resolve()

function persistBundle(bundle) {
  persistenceQueue = persistenceQueue
    .catch(() => undefined)
    .then(() => saveStoredBundle(bundle))
    .catch((error) => {
      setFeedback(`Could not save the local copy: ${error instanceof Error ? error.message : String(error)}`, true)
    })
}

state.subscribe((bundle) => {
  view.render(bundle)
  invalidateExportPreview()
  invalidateUsageAnalysis()
  if (bundle) persistBundle(bundle)
})
view.render(state.getBundle())

elements.toggleSettingsPanel.addEventListener('click', () => {
  setSettingsPanelVisibility(!settingsPanelVisible)
})

async function loadUsageAnalysis(wait: boolean): Promise<void> {
  const bundle = state.getBundle()
  if (!bundle) return
  const config = projectConfig
  elements.analyzeUsage.disabled = true
  elements.analyzeUsage.textContent = wait ? 'Updating usages…' : 'Loading usages…'
  try {
    const cached = await analyzeProjectUsage(bundle, config, wait)
    if (state.getBundle() !== bundle || projectConfig !== config) return
    if (cached.report) replaceUsageReport(cached.report)
    if (!wait && cached.cacheStatus !== 'verified') {
      setFeedback(cached.report
        ? 'Showing an unverified cached usage report while a fresh analysis runs…'
        : 'No usage cache was found. Analyzing typed references…')
      const refreshed = await analyzeProjectUsage(bundle, config, true)
      if (state.getBundle() !== bundle || projectConfig !== config) return
      if (refreshed.report) replaceUsageReport(refreshed.report)
    }
    const report = currentUsageReport
    if (!report) throw new Error('The usage analysis did not return a report.')
    const usages = Object.values(report.entries)
    const used = usages.filter(({ status }) => status === 'used').length
    const uncertain = usages.filter(({ status }) => status === 'uncertain').length
    const unreferenced = usages.filter(({ status }) => status === 'unreferenced').length
    setFeedback(`${used} used keys, ${uncertain} uncertain keys, and ${unreferenced} unreferenced keys across ${report.sourceFileCount} source files.`)
  } catch (error) {
    setFeedback(`Could not analyze usages: ${error instanceof Error ? error.message : String(error)}`, true)
  } finally {
    elements.analyzeUsage.disabled = !state.getBundle()
    elements.analyzeUsage.textContent = currentUsageReport ? 'Update usages' : 'Analyze usages'
  }
}

elements.analyzeUsage.addEventListener('click', async () => {
  await loadUsageAnalysis(true)
})

elements.showUnreferenced.addEventListener('change', () => {
  view.setShowUnreferenced(elements.showUnreferenced.checked)
})

elements.visualLevelCount.addEventListener('input', () => {
  const parsed = Number.parseInt(elements.visualLevelCount.value, 10)
  visualLevelCountOverride = Number.isFinite(parsed) ? Math.min(12, Math.max(0, parsed)) : 0
  elements.visualLevelCount.value = String(visualLevelCountOverride)
  view.setProjectConfig({ ...projectConfig, levelCount: visualLevelCountOverride })
})

elements.checkExportDiffs.addEventListener('click', async () => {
  const bundle = state.getBundle()
  if (!bundle) return

  const requestVersion = ++exportPreviewRequestVersion
  elements.checkExportDiffs.disabled = true
  elements.checkExportDiffs.textContent = 'Checking…'
  elements.exportPreviewFeedback.textContent = 'Comparing with the current project files…'
  elements.exportPreviewFeedback.classList.remove('error', 'warning')

  try {
    const result = await checkProjectExport(bundle, projectConfig)
    if (requestVersion !== exportPreviewRequestVersion) return
    checkedExportChanges = result.changes
    renderCurrentExportPreview()
    const changed = result.changes.filter(({ status }) => status !== 'unchanged').length
    const deletionCount = result.changes.filter(({ status }) => status === 'delete').length
    if (deletionCount > 0) {
      const deletionMessage = projectConfig.deletion !== false && projectConfig.deletion.autoDelete
        ? `${deletionCount} divergent file${deletionCount === 1 ? '' : 's'} will be deleted because autoDelete is enabled.`
        : `${deletionCount} deletion candidate${deletionCount === 1 ? '' : 's'} will be preserved without i18n-edit export --delete.`
      elements.exportPreviewFeedback.textContent = `${changed} file${changed === 1 ? '' : 's'} with planned changes. Warning: ${deletionMessage}`
      elements.exportPreviewFeedback.classList.add('warning')
    } else {
      elements.exportPreviewFeedback.textContent = changed === 0
        ? 'The project files already match the preview.'
        : `${changed} file${changed === 1 ? '' : 's'} with planned changes.`
    }
  } catch (error) {
    if (requestVersion !== exportPreviewRequestVersion) return
    elements.exportPreviewFeedback.textContent = `Could not check diffs: ${error instanceof Error ? error.message : String(error)}`
    elements.exportPreviewFeedback.classList.add('error')
  } finally {
    if (requestVersion === exportPreviewRequestVersion) {
      elements.checkExportDiffs.disabled = false
      elements.checkExportDiffs.textContent = 'Check again'
    }
  }
})

elements.exportProject.addEventListener('click', async () => {
  const bundle = state.getBundle()
  if (!bundle) return

  elements.exportProject.disabled = true
  elements.checkExportDiffs.disabled = true
  elements.exportProject.textContent = 'Preparing…'
  elements.exportPreviewFeedback.textContent = 'Recalculating the plan before export…'
  elements.exportPreviewFeedback.classList.remove('error', 'warning')

  try {
    const preview = await checkProjectExport(bundle, projectConfig)
    checkedExportChanges = preview.changes
    renderCurrentExportPreview()
    const writable = preview.changes.filter(({ status }) => status === 'create' || status === 'modify').length
    const deletionCandidates = preview.changes.filter(({ status }) => status === 'delete').length
    const deleteObsolete = projectConfig.deletion !== false
      && (projectConfig.deletion.autoDelete || elements.exportDeleteObsolete.checked)
    const deletionText = deletionCandidates === 0
      ? 'No files will be deleted.'
      : deleteObsolete
        ? `${deletionCandidates} divergent file${deletionCandidates === 1 ? '' : 's'} will be deleted.`
        : `${deletionCandidates} divergent file${deletionCandidates === 1 ? '' : 's'} will be preserved.`

    if (writable === 0 && (!deleteObsolete || deletionCandidates === 0)) {
      elements.exportPreviewFeedback.textContent = 'The project files are already up to date.'
      return
    }

    const confirmed = window.confirm(
      `Export changes to the project?\n\n${writable} file${writable === 1 ? '' : 's'} will be created or overwritten. ${deletionText}\n\nReview the displayed diffs before continuing.`,
    )
    if (!confirmed) {
      elements.exportPreviewFeedback.textContent = 'Export cancelled. No files were changed.'
      return
    }

    elements.exportProject.textContent = 'Exporting…'
    elements.exportPreviewFeedback.textContent = 'Writing files to the project…'
    const result = await exportProject(bundle, projectConfig, deleteObsolete)
    const currentPreview = await checkProjectExport(bundle, projectConfig)
    checkedExportChanges = currentPreview.changes
    renderCurrentExportPreview()
    elements.exportPreviewFeedback.textContent = [
      `${result.written} file${result.written === 1 ? '' : 's'} written.`,
      result.deleted > 0 ? `${result.deleted} deleted.` : '',
      result.preserved > 0 ? `${result.preserved} divergent file${result.preserved === 1 ? '' : 's'} preserved.` : '',
    ].filter(Boolean).join(' ')
    setFeedback('Changes exported to the project files.')
  } catch (error) {
    elements.exportPreviewFeedback.textContent = `Could not export: ${error instanceof Error ? error.message : String(error)}`
    elements.exportPreviewFeedback.classList.add('error')
  } finally {
    elements.exportProject.disabled = !state.getBundle()
    elements.checkExportDiffs.disabled = !state.getBundle()
    elements.exportProject.textContent = 'Export to project'
  }
})

elements.levelCount.addEventListener('input', () => {
  applyProjectConfig({
    ...projectConfig,
    levelCount: elements.levelCount.value,
  })
})

elements.levelNames.addEventListener('input', () => {
  applyProjectConfig({
    ...projectConfig,
    levelNames: elements.levelNames.value,
  })
})

elements.translationsDirectory.addEventListener('input', () => {
  applyProjectConfig({ ...projectConfig, translationsDirectory: elements.translationsDirectory.value })
})

elements.languageFileTemplate.addEventListener('input', () => {
  applyProjectConfig({ ...projectConfig, languageFileTemplate: elements.languageFileTemplate.value })
})

elements.importAliases.addEventListener('input', () => {
  try {
    const importAliases = parseJsonObject(elements.importAliases.value, 'Import aliases')
    applyProjectConfig({
      ...projectConfig,
      exportConfig: { ...projectConfig.exportConfig, importAliases },
    }, true, false, false)
    setFeedback('Import aliases updated.')
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error), true)
  }
})

elements.useDoubleQuotes.addEventListener('change', () => {
  applyProjectConfig({
    ...projectConfig,
    exportConfig: {
      ...projectConfig.exportConfig,
      codeFormat: {
        ...projectConfig.exportConfig.codeFormat,
        useDoubleQuotes: elements.useDoubleQuotes.checked,
      },
    },
  })
  setFeedback(elements.useDoubleQuotes.checked
    ? 'Exports will use double quotes.'
    : 'Exports will use single quotes.')
})

elements.useSemicolons.addEventListener('change', () => {
  applyProjectConfig({
    ...projectConfig,
    exportConfig: {
      ...projectConfig.exportConfig,
      codeFormat: {
        ...projectConfig.exportConfig.codeFormat,
        useSemicolons: elements.useSemicolons.checked,
      },
    },
  })
  setFeedback(elements.useSemicolons.checked
    ? 'Exports will use semicolons.'
    : 'Exports will not use semicolons.')
})

elements.useShorthandProperties.addEventListener('change', () => {
  applyProjectConfig({
    ...projectConfig,
    exportConfig: {
      ...projectConfig.exportConfig,
      codeFormat: {
        ...projectConfig.exportConfig.codeFormat,
        useShorthandProperties: elements.useShorthandProperties.checked,
      },
    },
  })
  setFeedback('Shorthand property preference updated.')
})

elements.useTrailingCommas.addEventListener('change', () => {
  applyProjectConfig({
    ...projectConfig,
    exportConfig: {
      ...projectConfig.exportConfig,
      codeFormat: {
        ...projectConfig.exportConfig.codeFormat,
        useTrailingCommas: elements.useTrailingCommas.checked,
      },
    },
  })
  setFeedback('Trailing comma preference updated.')
})

function updateIndentation(): void {
  applyProjectConfig({
    ...projectConfig,
    exportConfig: {
      ...projectConfig.exportConfig,
      codeFormat: {
        ...projectConfig.exportConfig.codeFormat,
        indentation: {
          character: elements.indentationCharacter.value,
          size: elements.indentationSize.value,
        },
      },
    },
  })
  setFeedback('Export indentation updated.')
}

elements.indentationCharacter.addEventListener('change', updateIndentation)
elements.indentationSize.addEventListener('input', updateIndentation)

elements.printWidth.addEventListener('input', () => {
  applyProjectConfig({
    ...projectConfig,
    exportConfig: {
      ...projectConfig.exportConfig,
      codeFormat: {
        ...projectConfig.exportConfig.codeFormat,
        printWidth: elements.printWidth.value,
      },
    },
  })
  setFeedback('Maximum export line width updated.')
})

function updateInlineItemLimits(): void {
  applyProjectConfig({
    ...projectConfig,
    exportConfig: {
      ...projectConfig.exportConfig,
      codeFormat: {
        ...projectConfig.exportConfig.codeFormat,
        maxObjectInlineItems: elements.maxObjectInlineItems.value,
        maxArrayInlineItems: elements.maxArrayInlineItems.value,
      },
    },
  })
  setFeedback('Inline collection limits updated.')
}

elements.maxObjectInlineItems.addEventListener('input', updateInlineItemLimits)
elements.maxArrayInlineItems.addEventListener('input', updateInlineItemLimits)

function updateCollectionLayouts(): void {
  applyProjectConfig({
    ...projectConfig,
    exportConfig: {
      ...projectConfig.exportConfig,
      codeFormat: {
        ...projectConfig.exportConfig.codeFormat,
        objectLayout: elements.objectLayout.value,
        arrayLayout: elements.arrayLayout.value,
      },
    },
  })
  setFeedback('Object and array layouts updated.')
}

elements.objectLayout.addEventListener('change', updateCollectionLayouts)
elements.arrayLayout.addEventListener('change', updateCollectionLayouts)

elements.languageReplacer.addEventListener('input', () => {
  try {
    const languageReplacer = parseJsonObject(elements.languageReplacer.value, 'Language replacer')
    applyProjectConfig({ ...projectConfig, languageReplacer }, true, false, false)
    setFeedback('Language replacer updated.')
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error), true)
  }
})

elements.deletionEnabled.addEventListener('change', () => {
  applyProjectConfig({
    ...projectConfig,
    deletion: elements.deletionEnabled.checked
      ? { ignoredExtensions: [], autoDelete: false }
      : false,
  })
  setFeedback(elements.deletionEnabled.checked
    ? 'Divergent file detection enabled.'
    : 'Deletion detection and warnings disabled.')
})

elements.ignoredDeletionExtensions.addEventListener('input', () => {
  if (projectConfig.deletion === false) return
  applyProjectConfig({
    ...projectConfig,
    deletion: {
      ...projectConfig.deletion,
      ignoredExtensions: elements.ignoredDeletionExtensions.value.split(','),
    },
  })
  setFeedback('Ignored extensions updated.')
})

elements.autoDelete.addEventListener('change', () => {
  if (projectConfig.deletion === false) return
  applyProjectConfig({
    ...projectConfig,
    deletion: { ...projectConfig.deletion, autoDelete: elements.autoDelete.checked },
  })
  setFeedback(elements.autoDelete.checked
    ? 'Automatic deletion enabled for this project.'
    : 'Deletions will require the --delete option again.')
})

function setProjectStatus(message, isError = false) {
  elements.projectStatus.hidden = false
  elements.projectStatus.classList.toggle('error', isError)
  elements.projectStatus.classList.toggle('loading', !isError)
  elements.projectStatusText.textContent = message
  elements.retryProjectLoad.hidden = !isError
}

function hideProjectStatus() {
  elements.projectStatus.hidden = true
}

async function loadProject() {
  setProjectStatus('Connecting to the project…')

  try {
    const [info, storedBundle, storedConfig] = await Promise.all([
      getProjectInfo(),
      loadStoredBundle(),
      loadStoredProjectConfig(),
    ])

    if (info.config) {
      applyProjectConfig(info.config, false)
    } else if (storedConfig && Array.isArray(storedConfig.levelImports)) {
      applyProjectConfig(storedConfig, false)
    }

    let projectBundle = info.bundle
    let generated = false
    if (!projectBundle) {
      if (!info.canGenerateBundle) {
        throw new Error('The project has no bundle and its TypeScript catalog could not be found.')
      }
      setProjectStatus('Generating the project bundle…')
      projectBundle = (await generateProjectBundle()).bundle
      generated = true
    }

    const projectIsNewer = storedBundle && projectBundle.updatedAt > storedBundle.updatedAt
    const selectedBundle = !storedBundle || projectIsNewer ? projectBundle : storedBundle

    if (projectIsNewer && !generated) {
      window.alert('A newer bundle exists in the project. It was loaded and will replace the browser copy.')
    }

    state.replaceBundle(selectedBundle)
    setFeedback(generated
      ? 'Bundle generated automatically from the project catalog.'
      : selectedBundle === storedBundle
        ? 'The newest version was restored from the browser.'
        : 'Project bundle loaded automatically.')
    hideProjectStatus()
    void loadUsageAnalysis(false)
  } catch (error) {
    setProjectStatus(
      `Could not load the project: ${error instanceof Error ? error.message : String(error)}`,
      true,
    )
  }
}

applyProjectConfig(projectConfig, false)
elements.retryProjectLoad.addEventListener('click', () => void loadProject())
void loadProject()
