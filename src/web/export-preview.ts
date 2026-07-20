import { buildExportPlan } from '../core/exportPlan.js'

const statusLabels = {
  create: 'new',
  modify: 'modified',
  unchanged: 'unchanged',
  delete: 'delete',
}

function createDiff(document, diff) {
  const pre = document.createElement('pre')
  pre.className = 'export-file-diff'
  diff.trimEnd().split('\n').forEach((line) => {
    const row = document.createElement('span')
    row.className = line.startsWith('+++') || line.startsWith('---')
      ? 'diff-file-header'
      : line.startsWith('@@')
        ? 'diff-range'
        : line.startsWith('+')
          ? 'diff-addition'
          : line.startsWith('-')
            ? 'diff-removal'
            : 'diff-context'
    row.textContent = line
    pre.append(row)
  })
  return pre
}

export function renderExportPreview(container, bundle, config, checkedChanges = null) {
  const document = container.ownerDocument

  if (!bundle) {
    container.textContent = 'Load a bundle to preview output files.'
    return
  }

  const plan = checkedChanges ?? buildExportPlan(bundle, config)
  if (plan.length === 0) {
    container.textContent = 'There are no translations to export.'
    return
  }

  const list = document.createElement('ul')
  list.className = 'export-preview-list'
  plan.forEach(({ path, status, diff }) => {
    const item = document.createElement('li')
    item.className = status ? `export-preview-item export-preview-${status}` : 'export-preview-item'
    const line = document.createElement('div')
    line.className = 'export-preview-path'
    if (status) {
      const badge = document.createElement('span')
      badge.className = 'export-preview-status'
      badge.textContent = statusLabels[status]
      line.append(badge)
    }
    const code = document.createElement('code')
    code.textContent = path
    line.append(code)
    item.append(line)
    if (diff && status !== 'delete') {
      const details = document.createElement('details')
      details.className = 'export-diff-details'
      const summary = document.createElement('summary')
      summary.textContent = 'Show diff'
      details.append(summary, createDiff(document, diff))
      item.append(details)
    }
    list.append(item)
  })
  container.replaceChildren(list)
}
