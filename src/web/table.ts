import type { I18nBundle } from '@wads.dev/i18n-ts/bundle'
import { getEditorLevelName, type EditorProjectConfig } from '../core/projectConfig.js'

function isFunctionDescriptor(value) {
  return value && typeof value === 'object' && value.$type === 'function'
}

function splitFunctionSource(source) {
  const arrowIndex = source.indexOf('=>')
  if (arrowIndex === -1) return { signature: 'ƒ function (…) => …', body: source }

  return {
    signature: `ƒ ${source.slice(0, arrowIndex).trim()} => …`,
    body: source.slice(arrowIndex + 2).trim(),
  }
}

function describeBase(entries) {
  const presentEntries = entries.filter(Boolean)
  if (presentEntries.length === 0) return { label: 'ausente', type: 'missing' }
  if (presentEntries.every((entry) => entry.type === 'string')) return { label: 'string', type: 'string' }
  if (presentEntries.every((entry) => entry.type === 'function')) {
    return { label: presentEntries[0].signature, type: 'function' }
  }
  return { label: 'inconsistente', type: 'inconsistent' }
}

function appendSegment(path, segment) {
  return segment.startsWith('[') ? `${path}${segment}` : path ? `${path}.${segment}` : segment
}

function flatten(value, path = '', entries = new Map()) {
  if (isFunctionDescriptor(value)) {
    const { signature, body } = splitFunctionSource(value.source)
    entries.set(path, { text: body, type: 'function', signature })
    return entries
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, appendSegment(path, `[${index}]`), entries))
    return entries
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, nestedValue]) => flatten(nestedValue, appendSegment(path, key), entries))
    return entries
  }

  entries.set(path, { text: value == null ? '' : String(value), type: 'string' })
  return entries
}

function createCell(document, value, className) {
  const cell = document.createElement('td')
  if (className) cell.className = className
  cell.textContent = value
  return cell
}

function beginTextEdit(cell, originalValue, onCommit) {
  let completed = false
  const input = cell.ownerDocument.createElement('input')
  input.className = 'inline-value-input'
  input.type = 'text'
  input.value = originalValue
  input.setAttribute('aria-label', 'Editar tradução')

  function finish(save) {
    if (completed) return
    completed = true

    if (!save || input.value === originalValue) {
      cell.textContent = originalValue
      return
    }
    if (onCommit(input.value) === false) cell.textContent = originalValue
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      finish(true)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      finish(false)
    }
  })
  input.addEventListener('blur', () => finish(true))
  cell.replaceChildren(input)
  input.focus()
  input.select()
}

function createRows(bundle: I18nBundle) {
  const languages = Object.entries(bundle.languages)
  const flattenedTranslations = Object.fromEntries(
    languages.map(([key, language]) => [key, flatten(language.translations)]),
  )
  const keys = [...new Set(Object.values(flattenedTranslations).flatMap((entries) => [...entries.keys()]))]
    .sort((left, right) => left.localeCompare(right))

  return {
    languages,
    rows: keys.map((fullKey) => ({
      fullKey,
      languageEntries: languages.map(([languageKey]) => flattenedTranslations[languageKey].get(fullKey)),
    })),
  }
}

function createGroupTree(rows, levelCount) {
  const root = { depth: 0, name: 'Raiz', rows: [], children: new Map() }

  rows.forEach((row) => {
    const segments = row.fullKey.split('.')
    const groupCount = Math.min(levelCount, Math.max(segments.length - 1, 0))
    let node = root

    for (let index = 0; index < groupCount; index += 1) {
      const name = segments[index]
      if (!node.children.has(name)) {
        node.children.set(name, { depth: index + 1, name, rows: [], children: new Map() })
      }
      node = node.children.get(name)
    }
    node.rows.push(row)
  })

  return root
}

function getNodeRowCount(node) {
  return node.rows.length + [...node.children.values()].reduce(
    (count, child) => count + getNodeRowCount(child),
    0,
  )
}

function getRelativeKey(fullKey, depth) {
  return fullKey.split('.').slice(depth).join('.')
}

function createTranslationTable(document, languages, rows, depth, { onMoveKey, onEditValue }) {
  const table = document.createElement('table')
  const header = table.createTHead().insertRow()
  const keyHeader = document.createElement('th')
  keyHeader.textContent = 'Chave'
  header.append(keyHeader)

  languages.forEach(([key, language]) => {
    const cell = document.createElement('th')
    cell.className = 'language-header'
    cell.textContent = `${key} · ${language.short}`
    header.append(cell)
  })

  const baseHeader = document.createElement('th')
  baseHeader.textContent = 'Base'
  header.append(baseHeader)

  const body = table.createTBody()
  rows.forEach((rowData) => {
    const row = body.insertRow()
    const { fullKey, languageEntries } = rowData
    row.dataset.search = [
      fullKey,
      ...languageEntries.map((entry) => entry?.text ?? ''),
    ].join(' ').toLocaleLowerCase()

    const keyCell = createCell(document, getRelativeKey(fullKey, depth), 'key')
    if (onMoveKey) {
      keyCell.title = 'Clique duas vezes para mover esta chave'
      keyCell.addEventListener('dblclick', () => onMoveKey(fullKey))
    }
    row.append(keyCell)

    languages.forEach(([languageKey], index) => {
      const entry = languageEntries[index]
      const className = ['language-value', entry?.type === 'function' ? 'function-value' : '']
        .filter(Boolean)
        .join(' ')
      const valueCell = createCell(document, entry?.text ?? 'Ausente', className)
      if (entry?.type === 'string' && onEditValue) {
        valueCell.title = 'Clique duas vezes para editar esta tradução'
        valueCell.addEventListener('dblclick', () => {
          beginTextEdit(valueCell, entry.text, (value) => onEditValue({
            languageKey,
            key: fullKey,
            value,
          }))
        })
      }
      row.append(valueCell)
    })

    const base = describeBase(languageEntries)
    row.append(createCell(document, base.label, `base-value base-${base.type}`))
  })

  return table
}

function appendTableGroup(document, container, node, languages, callbacks, isRoot = false) {
  if (isRoot) {
    if (node.rows.length > 0) {
      const rootGroup = document.createElement('section')
      rootGroup.className = 'table-group'
      const title = document.createElement('h3')
      title.className = 'table-group-title'
      title.textContent = 'Raiz'
      rootGroup.append(title, createTranslationTable(document, languages, node.rows, node.depth, callbacks))
      container.append(rootGroup)
    }
  } else {
    const details = document.createElement('details')
    details.className = 'translation-group'
    const summary = document.createElement('summary')
    const label = document.createElement('span')
    label.textContent = `${getEditorLevelName(callbacks.projectConfig, node.depth)} · ${node.name}`
    const count = document.createElement('span')
    count.className = 'group-count'
    count.textContent = `${getNodeRowCount(node)} chaves`
    summary.append(label, count)
    details.append(summary)

    const content = document.createElement('div')
    content.className = 'translation-group-content'
    if (node.rows.length > 0) {
      const tableGroup = document.createElement('section')
      tableGroup.className = 'table-group'
      if (node.children.size > 0) {
        const title = document.createElement('h3')
        title.className = 'table-group-title'
        title.textContent = 'Raiz'
        tableGroup.append(title)
      }
      tableGroup.append(createTranslationTable(document, languages, node.rows, node.depth, callbacks))
      content.append(tableGroup)
    }
    details.append(content)
    container.append(details)
    container = content
  }

  [...node.children.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .forEach((child) => appendTableGroup(document, container, child, languages, callbacks))
}

type RenderTranslationOptions = {
  projectConfig: EditorProjectConfig
  onMoveKey?: (sourceKey: string) => void
  onEditValue?: (change: { languageKey: string; key: string; value: string }) => boolean
}

export function renderTranslationTables(
  container: HTMLElement,
  bundle: I18nBundle,
  { projectConfig, onMoveKey, onEditValue }: RenderTranslationOptions,
) {
  const document = container.ownerDocument
  const { languages, rows } = createRows(bundle)
  const normalizedLevelCount = Math.max(0, Number.isInteger(projectConfig?.levelCount) ? projectConfig.levelCount : 0)
  const tree = createGroupTree(rows, normalizedLevelCount)
  const fragment = document.createDocumentFragment()

  appendTableGroup(document, fragment, tree, languages, { projectConfig, onMoveKey, onEditValue }, true)
  container.replaceChildren(fragment)
  return rows.length
}
