import {
  loadStoredBundle,
  loadStoredProjectConfig,
  saveStoredBundle,
  saveStoredProjectConfig,
} from './bundle-storage.js'
import { moveKey } from '../core/moveKey.js'
import { createDefaultEditorProjectConfig, normalizeEditorProjectConfig } from '../core/projectConfig.js'
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
  useDoubleQuotes: getElement<HTMLInputElement>('#use-double-quotes'),
  useSemicolons: getElement<HTMLInputElement>('#use-semicolons'),
  useShorthandProperties: getElement<HTMLInputElement>('#use-shorthand-properties'),
  useTrailingCommas: getElement<HTMLInputElement>('#use-trailing-commas'),
  indentationCharacter: getElement<HTMLSelectElement>('#indentation-character'),
  indentationSize: getElement<HTMLInputElement>('#indentation-size'),
  deletionEnabled: getElement<HTMLInputElement>('#deletion-enabled'),
  ignoredDeletionExtensions: getElement<HTMLInputElement>('#ignored-deletion-extensions'),
  autoDelete: getElement<HTMLInputElement>('#auto-delete'),
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
let projectConfig = createDefaultEditorProjectConfig()
let checkedExportChanges: ProjectExportPreviewChange[] | null = null
let exportPreviewRequestVersion = 0

function renderCurrentExportPreview() {
  renderExportPreview(elements.exportPreview, state.getBundle(), projectConfig, checkedExportChanges)
}

function invalidateExportPreview() {
  exportPreviewRequestVersion += 1
  checkedExportChanges = null
  elements.exportPreviewFeedback.textContent = ''
  elements.exportPreviewFeedback.classList.remove('error', 'warning')
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
  const codeFormat = projectConfig.exportConfig.codeFormat
  elements.useDoubleQuotes.checked = codeFormat.useDoubleQuotes
  elements.useSemicolons.checked = codeFormat.useSemicolons
  elements.useShorthandProperties.checked = codeFormat.useShorthandProperties
  elements.useTrailingCommas.checked = codeFormat.useTrailingCommas
  elements.indentationCharacter.value = codeFormat.indentation.character
  elements.indentationSize.value = String(codeFormat.indentation.size)
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
        ? `${deletionCount} arquivo${deletionCount === 1 ? '' : 's'} divergente${deletionCount === 1 ? '' : 's'} ${deletionCount === 1 ? 'será excluído' : 'serão excluídos'} durante o export porque autoDelete está ativo.`
        : `${deletionCount} candidato${deletionCount === 1 ? '' : 's'} à exclusão ${deletionCount === 1 ? 'será preservado' : 'serão preservados'} sem i18n-edit export --delete.`
      elements.exportPreviewFeedback.textContent = `${changed} arquivo${changed === 1 ? '' : 's'} com alterações planejadas. Atenção: ${deletionMessage}`
      elements.exportPreviewFeedback.classList.add('warning')
    } else {
      elements.exportPreviewFeedback.textContent = changed === 0
        ? 'Os arquivos do projeto já correspondem à prévia.'
        : `${changed} arquivo${changed === 1 ? '' : 's'} com alterações planejadas.`
    }
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
    applyProjectConfig({
      ...projectConfig,
      exportConfig: { ...projectConfig.exportConfig, importAliases },
    }, true, false, false)
    setFeedback('Aliases atualizados.')
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
    ? 'A exportação usará aspas duplas.'
    : 'A exportação usará aspas simples.')
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
    ? 'A exportação usará ponto e vírgula.'
    : 'A exportação não usará ponto e vírgula.')
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
  setFeedback('Preferência de propriedades shorthand atualizada.')
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
  setFeedback('Preferência de vírgula final atualizada.')
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
  setFeedback('Indentação da exportação atualizada.')
}

elements.indentationCharacter.addEventListener('change', updateIndentation)
elements.indentationSize.addEventListener('input', updateIndentation)

elements.languageReplacer.addEventListener('input', () => {
  try {
    const languageReplacer = parseJsonObject(elements.languageReplacer.value, 'Replacer dos idiomas')
    applyProjectConfig({ ...projectConfig, languageReplacer }, true, false, false)
    setFeedback('Replacer dos idiomas atualizado.')
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
    ? 'Detecção de arquivos divergentes ativada.'
    : 'Detecção e avisos de exclusão desativados.')
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
  setFeedback('Extensões ignoradas atualizadas.')
})

elements.autoDelete.addEventListener('change', () => {
  if (projectConfig.deletion === false) return
  applyProjectConfig({
    ...projectConfig,
    deletion: { ...projectConfig.deletion, autoDelete: elements.autoDelete.checked },
  })
  setFeedback(elements.autoDelete.checked
    ? 'Exclusão automática ativada para o projeto.'
    : 'Exclusões voltarão a exigir a opção --delete.')
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
