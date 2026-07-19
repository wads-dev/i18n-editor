import { renderTranslationTables } from './table.js'
import { createDefaultProjectConfig } from '@wads.dev/i18n-ts/config'

export function createEditorView({ emptyState, tableWrap, tableContainer, summary, search, onMoveKey, onEditValue }) {
  let currentRows = []
  let currentBundle = null
  let projectConfig = createDefaultProjectConfig()

  search.addEventListener('input', () => {
    const query = search.value.trim().toLocaleLowerCase()
    currentRows.forEach((row) => {
      row.hidden = query !== '' && !row.dataset.search.includes(query)
    })
  })

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
        onMoveKey,
        onEditValue,
      })
      currentRows = [...tableContainer.querySelectorAll('tbody tr')]
      emptyState.hidden = true
      tableWrap.hidden = false
      search.value = ''
      summary.textContent = `${keyCount} chaves em ${Object.keys(bundle.languages).length} idiomas.`
    },
    setProjectConfig(nextProjectConfig) {
      projectConfig = nextProjectConfig
      if (currentBundle) this.render(currentBundle)
    },
  }
}
