import {
  loadStoredBundle,
  loadStoredProjectConfig,
  loadStoredReviewBaseline,
  saveStoredBundle,
  saveStoredProjectConfig,
  saveStoredReviewBaseline,
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
import { initializeLanguage, setLanguage, type EditorLanguage } from './language.js'
import { translateHtml } from '@wads.dev/i18n-html'
import type { I18nBundle } from '@wads.dev/i18n-ts/bundle'
import {
  createReviewBaseline,
  getNewReviewKeys,
  getRemovedReviewKeys,
  type ReviewBaseline,
} from './review-baseline.js'

await initializeLanguage()

function translateStaticDocument(): void {
  translateHtml(document, Lang)
  document.title = `${Lang.page.title} · i18n`
}

translateStaticDocument()

const state = createEditorState()
const REVIEW_FILTER_STORAGE_KEY = '@wads.dev/i18n-editor/show-new-keys'
const TOOLBAR_VISIBILITY_STORAGE_KEY = '@wads.dev/i18n-editor/translation-toolbar-visible'

function getReviewFilterStorageKey(projectDirectory: string): string {
  return `${REVIEW_FILTER_STORAGE_KEY}:${projectDirectory}`
}

function loadShowNewKeysPreference(projectDirectory: string): boolean {
  return localStorage.getItem(getReviewFilterStorageKey(projectDirectory)) === 'true'
}

function saveShowNewKeysPreference(projectDirectory: string, value: boolean): void {
  localStorage.setItem(getReviewFilterStorageKey(projectDirectory), String(value))
}

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
  translationToolbar: getElement<HTMLElement>('#translation-toolbar'),
  toggleTranslationToolbar: getElement<HTMLButtonElement>('#toggle-translation-toolbar'),
  toggleSettingsPanel: getElement<HTMLButtonElement>('#toggle-settings-panel'),
  projectStatus: getElement<HTMLElement>('#project-status'),
  projectStatusText: getElement<HTMLElement>('#project-status-text'),
  retryProjectLoad: getElement<HTMLButtonElement>('#retry-project-load'),
  analyzeUsage: getElement<HTMLButtonElement>('#analyze-usage'),
  language: getElement<HTMLSelectElement>('#editor-language'),
  showUnreferenced: getElement<HTMLInputElement>('#show-unreferenced'),
  showNewKeys: getElement<HTMLInputElement>('#show-new-keys'),
  newKeyCount: getElement<HTMLOutputElement>('#new-key-count'),
  markCurrentReviewed: getElement<HTMLButtonElement>('#mark-current-reviewed'),
  toggleAllGroups: getElement<HTMLButtonElement>('#toggle-all-groups'),
  reviewSummary: getElement<HTMLElement>('#review-summary'),
  visualLevelCount: getElement<HTMLInputElement>('#visual-level-count'),
}

function setIconButtonLabel(button: HTMLButtonElement, label: string): void {
  button.title = label
  button.setAttribute('aria-label', label)
}

function setAllGroupsToggleState(expanded: boolean): void {
  const label = expanded ? Lang.editor.collapseAll : Lang.editor.expandAll
  setIconButtonLabel(elements.toggleAllGroups, label)
  elements.toggleAllGroups.setAttribute('aria-pressed', String(expanded))
  elements.toggleAllGroups.classList.toggle('is-expanded', expanded)
}

let settingsPanelVisible = false
let translationToolbarVisible = localStorage.getItem(TOOLBAR_VISIBILITY_STORAGE_KEY) !== 'false'
let projectConfig = createDefaultEditorProjectConfig()
let currentProjectDirectory = ''
let canGenerateProjectBundle = false
let checkedExportChanges: ProjectExportPreviewChange[] | null = null
let exportPreviewRequestVersion = 0
let visualLevelCountOverride: number | null = null
let currentUsageReport: TranslationUsageReport | null = null
let reviewBaseline: ReviewBaseline | null = null

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

function updateReviewControls(bundle = state.getBundle()): void {
  const newKeys = bundle ? getNewReviewKeys(bundle, reviewBaseline) : []
  const removedKeys = bundle ? getRemovedReviewKeys(bundle, reviewBaseline) : []
  view.setReviewKeys(newKeys, removedKeys)
  elements.markCurrentReviewed.disabled = !bundle
  elements.toggleAllGroups.disabled = !bundle
  if (!bundle) setAllGroupsToggleState(false)
  elements.showNewKeys.disabled = !bundle || reviewBaseline === null
  elements.newKeyCount.textContent = reviewBaseline ? String(newKeys.length + removedKeys.length) : ''
  if (!bundle) {
    elements.showNewKeys.checked = false
    view.setShowNewKeys(false)
    elements.reviewSummary.textContent = ''
    return
  }
  if (!reviewBaseline) {
    elements.showNewKeys.checked = false
    view.setShowNewKeys(false)
    elements.reviewSummary.textContent = Lang.editor.noReviewBaseline
    return
  }
  view.setShowNewKeys(elements.showNewKeys.checked)
  elements.reviewSummary.textContent = Lang.editor.reviewSummary(newKeys.length, removedKeys.length)
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
  elements.checkExportDiffs.textContent = Lang.exportPreview.checkDiffs
  renderCurrentExportPreview()
}

function invalidateUsageAnalysis(message = ''): void {
  view.setUsageReport(currentUsageReport)
  elements.analyzeUsage.disabled = !state.getBundle()
  setIconButtonLabel(elements.analyzeUsage, currentUsageReport ? Lang.editor.updateUsages : Lang.editor.analyzeUsages)
  if (message) setFeedback(message)
}

const view = createEditorView({
  emptyState: elements.emptyState,
  tableWrap: elements.tableWrap,
  tableContainer: elements.tableWrap,
  summary: elements.summary,
  search: elements.search,
  onMoveKey(sourceKey) {
    const targetKey = window.prompt(Lang.messages.moveKeyPrompt, sourceKey)
    if (targetKey === null || targetKey.trim() === '' || targetKey === sourceKey) return

    try {
      state.update((bundle) => moveKey(bundle, { sourceKey, targetKey: targetKey.trim() }))
      remapUsageKey(sourceKey, targetKey.trim())
      setFeedback(Lang.messages.keyMoved(sourceKey, targetKey.trim()))
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error), true)
    }
  },
  onRemoveKey(key) {
    if (!window.confirm(Lang.messages.removeKeyConfirm(key))) return
    try {
      state.update((bundle) => removeKey(bundle, { key }))
      removeUsageKey(key)
      setFeedback(Lang.messages.keyRemoved(key))
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error), true)
    }
  },
  onEditValue({ languageKey, key, value }) {
    try {
      state.update((bundle) => setStringValue(bundle, { languageKey, key, value }))
      setFeedback(Lang.messages.translationUpdated(languageKey, key))
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
    visible ? Lang.settings.hide : Lang.settings.show,
  )
  elements.toggleSettingsPanel.title = elements.toggleSettingsPanel.getAttribute('aria-label')
}

function setTranslationToolbarVisibility(visible: boolean, persist = true): void {
  translationToolbarVisible = visible
  elements.translationToolbar.hidden = !visible
  elements.toggleTranslationToolbar.setAttribute('aria-expanded', String(visible))
  setIconButtonLabel(elements.toggleTranslationToolbar, visible ? Lang.editor.hideToolbar : Lang.editor.showToolbar)
  elements.toggleTranslationToolbar.classList.toggle('toolbar-collapsed', !visible)
  if (persist) localStorage.setItem(TOOLBAR_VISIBILITY_STORAGE_KEY, String(visible))
}

let projectConfigQueue = Promise.resolve()

function parseJsonObject(value, fieldName) {
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(Lang.messages.jsonObjectExpected(fieldName))
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
        setFeedback(Lang.messages.configurationUpdated)
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
    .then(() => saveStoredProjectConfig(currentProjectDirectory, projectConfig))
    .catch((error) => {
      setFeedback(Lang.messages.couldNotSaveSettings(error instanceof Error ? error.message : String(error)), true)
    })
}

let persistenceQueue = Promise.resolve()

function persistBundle(bundle) {
  persistenceQueue = persistenceQueue
    .catch(() => undefined)
    .then(() => saveStoredBundle(currentProjectDirectory, bundle))
    .catch((error) => {
      setFeedback(Lang.messages.couldNotSaveLocalCopy(error instanceof Error ? error.message : String(error)), true)
    })
}

state.subscribe((bundle) => {
  view.render(bundle)
  setAllGroupsToggleState(false)
  updateReviewControls(bundle)
  invalidateExportPreview()
  invalidateUsageAnalysis()
  if (bundle) persistBundle(bundle)
})
view.render(state.getBundle())

elements.toggleSettingsPanel.addEventListener('click', () => {
  setSettingsPanelVisibility(!settingsPanelVisible)
})

elements.toggleTranslationToolbar.addEventListener('click', () => {
  setTranslationToolbarVisibility(!translationToolbarVisible)
})

elements.language.value = globalThis.CurrentLanguage
elements.language.addEventListener('change', async () => {
  await setLanguage(elements.language.value as EditorLanguage)
  translateStaticDocument()
  setTranslationToolbarVisibility(translationToolbarVisible, false)
  setSettingsPanelVisibility(settingsPanelVisible)
  applyProjectConfig(projectConfig, false)
  view.render(state.getBundle())
  setAllGroupsToggleState(false)
  updateReviewControls()
  invalidateExportPreview()
  invalidateUsageAnalysis()
})

async function loadUsageAnalysis(wait: boolean): Promise<void> {
  const bundle = state.getBundle()
  if (!bundle) return
  const config = projectConfig
  elements.analyzeUsage.disabled = true
  setIconButtonLabel(elements.analyzeUsage, wait ? Lang.editor.updatingUsages : Lang.editor.loadingUsages)
  try {
    const cached = await analyzeProjectUsage(bundle, config, wait)
    if (state.getBundle() !== bundle || projectConfig !== config) return
    if (cached.report) replaceUsageReport(cached.report)
    if (!wait && cached.cacheStatus !== 'verified') {
      setFeedback(cached.report
        ? Lang.messages.unverifiedUsageCache
        : Lang.messages.noUsageCache)
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
    setFeedback(Lang.messages.usageSummary(used, uncertain, unreferenced))
  } catch (error) {
    setFeedback(Lang.messages.couldNotAnalyzeUsages(error instanceof Error ? error.message : String(error)), true)
  } finally {
    elements.analyzeUsage.disabled = !state.getBundle()
    setIconButtonLabel(elements.analyzeUsage, currentUsageReport ? Lang.editor.updateUsages : Lang.editor.analyzeUsages)
  }
}

elements.analyzeUsage.addEventListener('click', async () => {
  const bundleBeforeRefresh = state.getBundle()
  if (bundleBeforeRefresh && canGenerateProjectBundle) {
    elements.analyzeUsage.disabled = true
    setIconButtonLabel(elements.analyzeUsage, Lang.messages.generatingBundle)
    await refreshBundleFromProject(bundleBeforeRefresh)
  }
  await loadUsageAnalysis(true)
})

elements.showUnreferenced.addEventListener('change', () => {
  view.setShowUnreferenced(elements.showUnreferenced.checked)
})

elements.showNewKeys.addEventListener('change', () => {
  view.setShowNewKeys(elements.showNewKeys.checked)
  if (!currentProjectDirectory) return
  try {
    saveShowNewKeysPreference(currentProjectDirectory, elements.showNewKeys.checked)
  } catch (error) {
    setFeedback(Lang.messages.couldNotSaveLocalCopy(error instanceof Error ? error.message : String(error)), true)
  }
})

elements.markCurrentReviewed.addEventListener('click', async () => {
  const bundle = state.getBundle()
  if (!bundle || !currentProjectDirectory) return
  const nextBaseline = createReviewBaseline(bundle)
  elements.markCurrentReviewed.disabled = true
  try {
    await saveStoredReviewBaseline(currentProjectDirectory, nextBaseline)
    reviewBaseline = nextBaseline
    updateReviewControls(bundle)
    setFeedback(Lang.messages.reviewBaselineSaved(nextBaseline.keys.length))
  } catch (error) {
    setFeedback(Lang.messages.couldNotSaveLocalCopy(error instanceof Error ? error.message : String(error)), true)
  } finally {
    elements.markCurrentReviewed.disabled = !state.getBundle()
  }
})

elements.toggleAllGroups.addEventListener('click', () => {
  setAllGroupsToggleState(view.toggleAllGroups())
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
  elements.checkExportDiffs.textContent = Lang.exportPreview.checking
  elements.exportPreviewFeedback.textContent = Lang.messages.comparingFiles
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
        ? Lang.messages.autoDeleteWarning(deletionCount)
        : Lang.messages.preservedDeletionWarning(deletionCount)
      elements.exportPreviewFeedback.textContent = `${Lang.messages.plannedChanges(changed)} ${deletionMessage}`
      elements.exportPreviewFeedback.classList.add('warning')
    } else {
      elements.exportPreviewFeedback.textContent = changed === 0
        ? Lang.messages.projectMatchesPreview
        : Lang.messages.plannedChanges(changed)
    }
  } catch (error) {
    if (requestVersion !== exportPreviewRequestVersion) return
    elements.exportPreviewFeedback.textContent = Lang.messages.couldNotCheckDiffs(error instanceof Error ? error.message : String(error))
    elements.exportPreviewFeedback.classList.add('error')
  } finally {
    if (requestVersion === exportPreviewRequestVersion) {
      elements.checkExportDiffs.disabled = false
      elements.checkExportDiffs.textContent = Lang.exportPreview.checkAgain
    }
  }
})

elements.exportProject.addEventListener('click', async () => {
  const bundle = state.getBundle()
  if (!bundle) return

  elements.exportProject.disabled = true
  elements.checkExportDiffs.disabled = true
  elements.exportProject.textContent = Lang.exportPreview.preparing
  elements.exportPreviewFeedback.textContent = Lang.messages.recalculating
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
      ? Lang.messages.noFilesDeleted
      : deleteObsolete
        ? Lang.messages.filesWillBeDeleted(deletionCandidates)
        : Lang.messages.filesWillBePreserved(deletionCandidates)

    if (writable === 0 && (!deleteObsolete || deletionCandidates === 0)) {
      elements.exportPreviewFeedback.textContent = Lang.messages.projectUpToDate
      return
    }

    const confirmed = window.confirm(Lang.messages.exportConfirm(writable, deletionText))
    if (!confirmed) {
      elements.exportPreviewFeedback.textContent = Lang.messages.exportCancelled
      return
    }

    elements.exportProject.textContent = Lang.exportPreview.exporting
    elements.exportPreviewFeedback.textContent = Lang.messages.writingFiles
    const result = await exportProject(bundle, projectConfig, deleteObsolete)
    const currentPreview = await checkProjectExport(bundle, projectConfig)
    checkedExportChanges = currentPreview.changes
    renderCurrentExportPreview()
    elements.exportPreviewFeedback.textContent = Lang.messages.exportResult(result.written, result.deleted, result.preserved)
    setFeedback(Lang.messages.exported)
  } catch (error) {
    elements.exportPreviewFeedback.textContent = Lang.messages.couldNotExport(error instanceof Error ? error.message : String(error))
    elements.exportPreviewFeedback.classList.add('error')
  } finally {
    elements.exportProject.disabled = !state.getBundle()
    elements.checkExportDiffs.disabled = !state.getBundle()
    elements.exportProject.textContent = Lang.exportPreview.exportProject
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
    setFeedback(Lang.messages.importAliasesUpdated)
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
    ? Lang.messages.doubleQuotesEnabled
    : Lang.messages.singleQuotesEnabled)
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
    ? Lang.messages.semicolonsEnabled
    : Lang.messages.semicolonsDisabled)
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
  setFeedback(Lang.messages.shorthandUpdated)
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
  setFeedback(Lang.messages.trailingCommasUpdated)
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
  setFeedback(Lang.messages.indentationUpdated)
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
  setFeedback(Lang.messages.printWidthUpdated)
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
  setFeedback(Lang.messages.inlineLimitsUpdated)
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
  setFeedback(Lang.messages.layoutsUpdated)
}

elements.objectLayout.addEventListener('change', updateCollectionLayouts)
elements.arrayLayout.addEventListener('change', updateCollectionLayouts)

elements.languageReplacer.addEventListener('input', () => {
  try {
    const languageReplacer = parseJsonObject(elements.languageReplacer.value, 'Language replacer')
    applyProjectConfig({ ...projectConfig, languageReplacer }, true, false, false)
    setFeedback(Lang.messages.languageReplacerUpdated)
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
    ? Lang.messages.deletionDetectionEnabled
    : Lang.messages.deletionDetectionDisabled)
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
  setFeedback(Lang.messages.ignoredExtensionsUpdated)
})

elements.autoDelete.addEventListener('change', () => {
  if (projectConfig.deletion === false) return
  applyProjectConfig({
    ...projectConfig,
    deletion: { ...projectConfig.deletion, autoDelete: elements.autoDelete.checked },
  })
  setFeedback(elements.autoDelete.checked
    ? Lang.messages.autoDeleteEnabled
    : Lang.messages.autoDeleteDisabled)
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

async function refreshBundleFromProject(bundleBeforeRefresh: I18nBundle, refreshUsage = false): Promise<boolean> {
  if (!canGenerateProjectBundle) return false

  try {
    const generatedBundle = (await generateProjectBundle()).bundle
    if (state.getBundle() !== bundleBeforeRefresh) return false
    state.replaceBundle(generatedBundle)
    setFeedback(Lang.messages.generatedBundle)
    if (refreshUsage) void loadUsageAnalysis(false)
    return true
  } catch (error) {
    setFeedback(
      Lang.messages.couldNotGenerateBundle(error instanceof Error ? error.message : String(error)),
      true,
    )
    return false
  }
}

async function loadProject() {
  setProjectStatus(Lang.messages.connecting)

  try {
    const info = await getProjectInfo()
    currentProjectDirectory = info.projectDirectory
    canGenerateProjectBundle = info.canGenerateBundle
    const [storedBundle, storedConfig, storedReviewBaseline] = await Promise.all([
      loadStoredBundle(currentProjectDirectory),
      loadStoredProjectConfig(currentProjectDirectory),
      loadStoredReviewBaseline(currentProjectDirectory),
    ])
    reviewBaseline = storedReviewBaseline
    elements.showNewKeys.checked = reviewBaseline !== null && loadShowNewKeysPreference(currentProjectDirectory)

    if (info.config) {
      applyProjectConfig(info.config, false)
    } else if (storedConfig && Array.isArray(storedConfig.levelImports)) {
      applyProjectConfig(storedConfig, false)
    }

    const projectBundle = info.bundle
    if (!projectBundle && !storedBundle && !info.canGenerateBundle) {
      throw new Error(Lang.messages.missingCatalog)
    }

    const projectIsNewer = Boolean(storedBundle && projectBundle && projectBundle.updatedAt > storedBundle.updatedAt)
    const selectedBundle = !storedBundle || (projectBundle && projectIsNewer) ? projectBundle : storedBundle

    if (projectIsNewer) {
      window.alert(Lang.messages.newerBundle)
    }

    if (selectedBundle) {
      state.replaceBundle(selectedBundle)
      setFeedback(selectedBundle === storedBundle
        ? Lang.messages.restoredBundle
        : Lang.messages.loadedBundle)
      hideProjectStatus()
      void loadUsageAnalysis(false)
      void refreshBundleFromProject(selectedBundle, true)
      return
    }

    setProjectStatus(Lang.messages.generatingBundle)
    const generatedBundle = (await generateProjectBundle()).bundle
    state.replaceBundle(generatedBundle)
    setFeedback(Lang.messages.generatedBundle)
    hideProjectStatus()
    void loadUsageAnalysis(false)
  } catch (error) {
    setProjectStatus(
      Lang.messages.couldNotLoadProject(error instanceof Error ? error.message : String(error)),
      true,
    )
  }
}

applyProjectConfig(projectConfig, false)
setSettingsPanelVisibility(false)
setTranslationToolbarVisibility(translationToolbarVisible, false)
elements.retryProjectLoad.addEventListener('click', () => void loadProject())
void loadProject()
