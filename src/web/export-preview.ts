import { buildExportPlan } from '../core/exportPlan.js'

export function renderExportPreview(container, bundle, config) {
  const document = container.ownerDocument

  if (!bundle) {
    container.textContent = 'Carregue um bundle para visualizar os arquivos de saída.'
    return
  }

  const plan = buildExportPlan(bundle, config)
  if (plan.length === 0) {
    container.textContent = 'Não há traduções para exportar.'
    return
  }

  const list = document.createElement('ul')
  list.className = 'export-preview-list'
  plan.forEach(({ path }) => {
    const item = document.createElement('li')
    const code = document.createElement('code')
    code.textContent = path
    item.append(code)
    list.append(item)
  })
  container.replaceChildren(list)
}
