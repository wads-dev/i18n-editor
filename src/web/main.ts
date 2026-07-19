import {
  loadStoredBundle,
  loadStoredProjectConfig,
  saveStoredBundle,
  saveStoredProjectConfig,
} from './bundle-storage.js'
import { moveKey } from '../core/moveKey.js'
import { createDefaultProjectConfig, normalizeProjectConfig } from '@wads.dev/i18n-ts/config'
import { setStringValue } from '../core/setStringValue.js'
import { renderExportPreview } from './export-preview.js'
import { renderLevelImportFields } from './project-settings.js'
import { checkProjectExport, generateProjectBundle, getProjectInfo } from './project-api.js'
import { createEditorState } from './state.js'
import { createEditorView } from './view.js'
import type { ProjectExportPreviewChange } from '../core/projectApi.js'

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
  exportPreview: getElement<HTMLElement>('#export-preview'),
  exportPreviewFeedback: getElement<HTMLElement>('#export-preview-feedback'),
  checkExportDiffs: getElement<HTMLButtonElement>('#check-export-diffs'),
  search: getElement<HTMLInputElement>('#translation-search'),
  summary: getElement<HTMLElement>('#bundle-summary'),
  settingsPanel: getElement<HTMLElement>('#settings-panel'),
  tableWrap: getElement<HTMLElement>('#table-wrap'),
  toggleSettingsPanel: getElement<HTMLButtonElement>('#toggle-settings-panel'),
  projectStatus: getElement<HTMLElement>('#project-status'),
  projectStatusText: getElement<HTMLElement>('#project-status-text'),
  retryProjectLoad: getElement<HTMLButtonElement>('#retry-project-load'),
}

let settingsPanelVisible = false
let projectConfig = createDefaultProjectConfig()
let checkedExportChanges: ProjectExportPreviewChange[] | null = null
let exportPreviewRequestVersion = 0

function renderCurrentExportPreview() {
  renderExportPreview(elements.exportPreview, state.getBundle(), projectConfig, checkedExportChanges)
}

function invalidateExportPreview() {
  exportPreviewRequestVersion += 1
  checkedExportChanges = null
  elements.exportPreviewFeedback.textContent = ''
  elements.exportPreviewFeedback.classList.remove('error')
  elements.checkExportDiffs.disabled = !state.getBundle()
  elements.checkExportDiffs.textContent = 'Verificar diffs'
  renderCurrentExportPreview()
}

const view = createEditorView({
  emptyState: elements.emptyState,
  tableWrap: elements.tableWrap,
  tableContainer: elements.tableWrap,
  summary: elements.summary,
  search: elements.search,
  onMoveKey(sourceKey) {
    const targetKey = window.prompt('Mover chave para:', sourceKey)
    if (targetKey === null || targetKey.trim() === '' || targetKey === sourceKey) return

    try {
      state.update((bundle) => moveKey(bundle, { sourceKey, targetKey: targetKey.trim() }))
      setFeedback(`Chave movida de ${sourceKey} para ${targetKey.trim()}.`)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error), true)
    }
  },
  onEditValue({ languageKey, key, value }) {
    try {
      state.update((bundle) => setStringValue(bundle, { languageKey, key, value }))
      setFeedback(`Tradução ${languageKey}.${key} atualizada.`)
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
    visible ? 'Ocultar configurações' : 'Mostrar configurações',
  )
  elements.toggleSettingsPanel.title = elements.toggleSettingsPanel.getAttribute('aria-label')
}

let projectConfigQueue = Promise.resolve()

function parseJsonObject(value, fieldName) {
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} deve ser um objeto JSON.`)
  }
  return parsed
}

function applyProjectConfig(nextConfig, persist = true, renderLevelImports = true, syncJsonFields = true) {
  projectConfig = normalizeProjectConfig(nextConfig)
  elements.levelCount.value = String(projectConfig.levelCount)
  elements.levelNames.value = projectConfig.levelNames
  elements.translationsDirectory.value = projectConfig.translationsDirectory
  elements.languageFileTemplate.value = projectConfig.languageFileTemplate
  if (syncJsonFields) {
    elements.importAliases.value = JSON.stringify(projectConfig.importAliases, null, 2)
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
        setFeedback('Configuração atualizada.')
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : String(error), true)
      }
    })
  }
  view.setProjectConfig(projectConfig)
  invalidateExportPreview()

  if (!persist) return
  projectConfigQueue = projectConfigQueue
    .catch(() => undefined)
    .then(() => saveStoredProjectConfig(projectConfig))
    .catch((error) => {
      setFeedback(`Não foi possível salvar as configurações: ${error instanceof Error ? error.message : String(error)}`, true)
    })
}

let persistenceQueue = Promise.resolve()

function persistBundle(bundle) {
  persistenceQueue = persistenceQueue
    .catch(() => undefined)
    .then(() => saveStoredBundle(bundle))
    .catch((error) => {
      setFeedback(`Não foi possível salvar a cópia local: ${error instanceof Error ? error.message : String(error)}`, true)
    })
}

state.subscribe((bundle) => {
  view.render(bundle)
  invalidateExportPreview()
  if (bundle) persistBundle(bundle)
})
view.render(state.getBundle())

elements.toggleSettingsPanel.addEventListener('click', () => {
  setSettingsPanelVisibility(!settingsPanelVisible)
})

elements.checkExportDiffs.addEventListener('click', async () => {
  const bundle = state.getBundle()
  if (!bundle) return

  const requestVersion = ++exportPreviewRequestVersion
  elements.checkExportDiffs.disabled = true
  elements.checkExportDiffs.textContent = 'Verificando…'
  elements.exportPreviewFeedback.textContent = 'Comparando com os arquivos atuais do projeto…'
  elements.exportPreviewFeedback.classList.remove('error')

  try {
    const result = await checkProjectExport(bundle, projectConfig)
    if (requestVersion !== exportPreviewRequestVersion) return
    checkedExportChanges = result.changes
    renderCurrentExportPreview()
    const changed = result.changes.filter(({ status }) => status !== 'unchanged').length
    elements.exportPreviewFeedback.textContent = changed === 0
      ? 'Os arquivos do projeto já correspondem à prévia.'
      : `${changed} arquivo${changed === 1 ? '' : 's'} com alterações planejadas.`
  } catch (error) {
    if (requestVersion !== exportPreviewRequestVersion) return
    elements.exportPreviewFeedback.textContent = `Não foi possível verificar os diffs: ${error instanceof Error ? error.message : String(error)}`
    elements.exportPreviewFeedback.classList.add('error')
  } finally {
    if (requestVersion === exportPreviewRequestVersion) {
      elements.checkExportDiffs.disabled = false
      elements.checkExportDiffs.textContent = 'Verificar novamente'
    }
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
    const importAliases = parseJsonObject(elements.importAliases.value, 'Aliases de import')
    applyProjectConfig({ ...projectConfig, importAliases }, true, false, false)
    setFeedback('Aliases atualizados.')
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error), true)
  }
})

elements.languageReplacer.addEventListener('input', () => {
  try {
    const languageReplacer = parseJsonObject(elements.languageReplacer.value, 'Replacer dos idiomas')
    applyProjectConfig({ ...projectConfig, languageReplacer }, true, false, false)
    setFeedback('Replacer dos idiomas atualizado.')
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error), true)
  }
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
  setProjectStatus('Conectando ao projeto…')

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
        throw new Error('O projeto não possui uma bundle e o catálogo TypeScript não foi encontrado.')
      }
      setProjectStatus('Gerando a bundle do projeto…')
      projectBundle = (await generateProjectBundle()).bundle
      generated = true
    }

    const projectIsNewer = storedBundle && projectBundle.updatedAt > storedBundle.updatedAt
    const selectedBundle = !storedBundle || projectIsNewer ? projectBundle : storedBundle

    if (projectIsNewer && !generated) {
      window.alert('Existe uma bundle mais recente no projeto. Ela foi carregada e substituirá a cópia local do navegador.')
    }

    state.replaceBundle(selectedBundle)
    setFeedback(generated
      ? 'Bundle gerada automaticamente a partir do catálogo do projeto.'
      : selectedBundle === storedBundle
        ? 'Versão mais recente restaurada do navegador.'
        : 'Bundle do projeto carregada automaticamente.')
    hideProjectStatus()
  } catch (error) {
    setProjectStatus(
      `Não foi possível carregar o projeto: ${error instanceof Error ? error.message : String(error)}`,
      true,
    )
  }
}

applyProjectConfig(projectConfig, false)
elements.retryProjectLoad.addEventListener('click', () => void loadProject())
void loadProject()
