import { renderTranslationTables } from './table.js'
import { createDefaultEditorProjectConfig } from '../core/projectConfig.js'

export function createEditorView({ emptyState, tableWrap, tableContainer, summary, search, onMoveKey, onRemoveKey, onEditValue }) {
  let currentRows = []
  let currentBundle = null
  let projectConfig = createDefaultEditorProjectConfig()
  let usageReport = null
  let showUnreferenced = false

  function applyFilters() {
    const query = search.value.trim().toLocaleLowerCase()
    currentRows.forEach((row) => {
      const matchesSearch = query === '' || row.dataset.search.includes(query)
      const matchesUsage = !showUnreferenced || row.dataset.usageStatus === 'unreferenced'
      row.hidden = !matchesSearch || !matchesUsage
    })
    tableContainer.querySelectorAll('.table-group, .translation-group').forEach((group) => {
      group.hidden = group.querySelector('tbody tr:not([hidden])') === null
    })
  }

  search.addEventListener('input', applyFilters)

  return {
    render(bundle) {
      currentBundle = bundle
      if (!bundle) {
        emptyState.hidden = false
        tableWrap.hidden = true
        summary.textContent = 'Carregue um bundle para visualizar as traduções.'
        search.value = ''
        currentRows = []
        return
      }

      const keyCount = renderTranslationTables(tableContainer, bundle, {
        projectConfig,
        usageReport,
        onMoveKey,
        onRemoveKey,
        onEditValue,
      })
      currentRows = [...tableContainer.querySelectorAll('tbody tr')]
      emptyState.hidden = true
      tableWrap.hidden = false
      applyFilters()
      summary.textContent = `${keyCount} chaves em ${Object.keys(bundle.languages).length} idiomas.`
    },
    setProjectConfig(nextProjectConfig) {
      projectConfig = nextProjectConfig
      if (currentBundle) this.render(currentBundle)
    },
    setUsageReport(nextUsageReport) {
      usageReport = nextUsageReport
      if (currentBundle) this.render(currentBundle)
    },
    setShowUnreferenced(value) {
      showUnreferenced = value
      applyFilters()
    },
  }
}
