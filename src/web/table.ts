import type { I18nBundle } from '@wads.dev/i18n-ts/bundle'
import type { TranslationUsageEntry, TranslationUsageReport } from '../core/projectApi.js'
import { getEditorLevelName, type EditorProjectConfig } from '../core/projectConfig.js'

let activeUsagePopover: { element: HTMLElement; trigger: HTMLButtonElement; close: () => void } | null = null

function getDisplayLevelName(config: EditorProjectConfig, level: number): string {
  const configured = getEditorLevelName(config, level)
  return configured === `Level ${level}` ? Lang.common.level(level) : configured
}

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
  if (presentEntries.length === 0) return { label: Lang.editor.missing, type: 'missing' }
  if (presentEntries.every((entry) => entry.type === 'string')) return { label: 'string', type: 'string' }
  if (presentEntries.every((entry) => entry.type === 'function')) {
    return { label: presentEntries[0].signature, type: 'function' }
  }
  return { label: Lang.editor.inconsistent, type: 'inconsistent' }
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

function createUsageCell(document: Document, usage: TranslationUsageEntry | undefined): HTMLTableCellElement {
  const cell = document.createElement('td')
  cell.className = 'usage-cell'
  if (!usage) {
    cell.classList.add('usage-empty')
    cell.textContent = Lang.editor.notAnalyzed
    return cell
  }
  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = `usage-trigger usage-${usage.status}`
  trigger.setAttribute('aria-expanded', 'false')
  const count = document.createElement('span')
  count.textContent = Lang.editor.usageSummary(
    usage.status === 'uncertain' ? usage.uncertainReferenceCount : usage.referenceCount,
    usage.fileCount,
    usage.status === 'uncertain',
  )
  const action = document.createElement('span')
  action.className = 'usage-trigger-action'
  action.textContent = Lang.editor.viewDetails
  trigger.append(count, action)

  const references = document.createElement('div')
  references.className = `usage-popover usage-popover-${usage.status}`
  references.setAttribute('role', 'dialog')
  const title = document.createElement('strong')
  title.textContent = usage.status === 'uncertain'
    ? Lang.editor.potentiallyReachable
    : usage.status === 'unreferenced'
      ? Lang.editor.noStaticReferences
      : Lang.editor.referencesFound
  references.append(title)
  const displayedReferences = usage.status === 'uncertain' ? usage.uncertainReferences : usage.references
  if (displayedReferences.length === 0) {
    const empty = document.createElement('span')
    empty.textContent = usage.status === 'uncertain'
      ? Lang.editor.dynamicMayReach
      : Lang.editor.noExactReferences
    references.append(empty)
  } else {
    displayedReferences.forEach((reference) => {
      const location = document.createElement('code')
      location.textContent = `${reference.file}:${reference.line}:${reference.column}`
      references.append(location)
    })
  }

  trigger.addEventListener('click', () => {
    if (activeUsagePopover?.trigger === trigger) {
      activeUsagePopover.close()
      return
    }
    activeUsagePopover?.close()
    const view = document.defaultView
    if (!view) return
    document.body.append(references)
    trigger.setAttribute('aria-expanded', 'true')

    const position = () => {
      const triggerRect = trigger.getBoundingClientRect()
      const popoverRect = references.getBoundingClientRect()
      const margin = 12
      const left = Math.min(
        Math.max(margin, triggerRect.left),
        Math.max(margin, view.innerWidth - popoverRect.width - margin),
      )
      const below = triggerRect.bottom + 8
      const top = below + popoverRect.height <= view.innerHeight - margin
        ? below
        : Math.max(margin, triggerRect.top - popoverRect.height - 8)
      references.style.left = `${left}px`
      references.style.top = `${top}px`
    }

    const close = () => {
      references.remove()
      trigger.setAttribute('aria-expanded', 'false')
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
      view.removeEventListener('resize', close)
      view.removeEventListener('scroll', close, true)
      if (activeUsagePopover?.trigger === trigger) activeUsagePopover = null
    }
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target || references.contains(target) || trigger.contains(target)) return
      close()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
        trigger.focus()
      }
    }

    activeUsagePopover = { element: references, trigger, close }
    position()
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    view.addEventListener('resize', close)
    view.addEventListener('scroll', close, true)
  })
  cell.append(trigger)
  return cell
}

function beginTextEdit(cell, originalValue, onCommit) {
  let completed = false
  const input = cell.ownerDocument.createElement('input')
  input.className = 'inline-value-input'
  input.type = 'text'
  input.value = originalValue
  input.setAttribute('aria-label', Lang.editor.editTranslation)

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

function createRows(bundle: I18nBundle, removedKeys: string[] = []) {
  const languages = Object.entries(bundle.languages)
  const flattenedTranslations = Object.fromEntries(
    languages.map(([key, language]) => [key, flatten(language.translations)]),
  )
  const keys = [...new Set(Object.values(flattenedTranslations).flatMap((entries) => [...entries.keys()]))]
    .sort((left, right) => left.localeCompare(right))

  const currentRows = keys.map((fullKey) => ({
    fullKey,
    removed: false,
    languageEntries: languages.map(([languageKey]) => flattenedTranslations[languageKey].get(fullKey)),
  }))
  const currentKeySet = new Set(keys)
  const removedRows = removedKeys
    .filter((fullKey) => !currentKeySet.has(fullKey))
    .sort((left, right) => left.localeCompare(right))
    .map((fullKey) => ({
      fullKey,
      removed: true,
      languageEntries: languages.map(() => undefined),
    }))

  return {
    languages,
    rows: [...currentRows, ...removedRows],
    currentKeyCount: currentRows.length,
  }
}

function createGroupTree(rows, levelCount) {
  const root = { depth: 0, name: 'Root', rows: [], children: new Map() }

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

function createTranslationTable(document, languages, rows, depth, { onMoveKey, onRemoveKey, onEditValue, usageReport }) {
  const table = document.createElement('table')
  const header = table.createTHead().insertRow()
  const keyHeader = document.createElement('th')
  keyHeader.textContent = Lang.editor.key
  header.append(keyHeader)

  const usageHeader = document.createElement('th')
  usageHeader.textContent = Lang.editor.usages
  header.append(usageHeader)

  languages.forEach(([key, language]) => {
    const cell = document.createElement('th')
    cell.className = 'language-header'
    cell.textContent = `${key} · ${language.short}`
    header.append(cell)
  })

  const baseHeader = document.createElement('th')
  baseHeader.textContent = Lang.editor.base
  header.append(baseHeader)

  const body = table.createTBody()
  rows.forEach((rowData) => {
    const row = body.insertRow()
    const { fullKey, languageEntries, removed } = rowData
    if (removed) row.classList.add('review-removed-row')
    row.dataset.translationKey = fullKey
    row.dataset.reviewStatus = removed ? 'removed' : 'current'
    row.dataset.search = [
      fullKey,
      ...languageEntries.map((entry) => entry?.text ?? ''),
    ].join(' ').toLocaleLowerCase()
    row.dataset.usageStatus = removed ? 'removed' : usageReport?.entries[fullKey]?.status || 'not-analyzed'

    const keyCell = document.createElement('td')
    keyCell.className = 'key'
    const keyContent = document.createElement('div')
    keyContent.className = 'key-content'
    const keyLabel = document.createElement('span')
    keyLabel.textContent = getRelativeKey(fullKey, depth)
    if (!removed && onMoveKey) {
      keyCell.title = Lang.editor.doubleClickMove
      keyCell.addEventListener('dblclick', () => onMoveKey(fullKey))
    }
    if (!removed && onRemoveKey) {
      const removeButton = document.createElement('button')
      removeButton.type = 'button'
      removeButton.className = [
        'remove-key-button',
        usageReport?.entries[fullKey]?.status === 'unreferenced' ? 'remove-key-button-unreferenced' : '',
      ].filter(Boolean).join(' ')
      removeButton.title = Lang.editor.removeKey(fullKey)
      removeButton.setAttribute('aria-label', Lang.editor.removeKey(fullKey))
      removeButton.textContent = '×'
      removeButton.addEventListener('click', (event) => {
        event.stopPropagation()
        onRemoveKey(fullKey)
      })
      removeButton.addEventListener('dblclick', (event) => event.stopPropagation())
      keyContent.append(removeButton)
    }
    keyContent.append(keyLabel)
    keyCell.append(keyContent)
    row.append(keyCell)
    row.append(removed
      ? createCell(document, Lang.editor.removed, 'usage-cell review-removed-value')
      : createUsageCell(document, usageReport?.entries[fullKey]))

    languages.forEach(([languageKey], index) => {
      const entry = languageEntries[index]
      const className = ['language-value', entry?.type === 'function' ? 'function-value' : '']
        .filter(Boolean)
        .join(' ')
      const valueCell = createCell(document, entry?.text ?? (removed ? Lang.editor.removed : Lang.editor.missing), className)
      if (!removed && entry?.type === 'string' && onEditValue) {
        valueCell.title = Lang.editor.doubleClickEdit
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

    const base = removed ? { label: Lang.editor.removed, type: 'removed' } : describeBase(languageEntries)
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
      title.textContent = Lang.common.root
      rootGroup.append(title, createTranslationTable(document, languages, node.rows, node.depth, callbacks))
      container.append(rootGroup)
    }
  } else {
    const details = document.createElement('details')
    details.className = 'translation-group'
    const summary = document.createElement('summary')
    const label = document.createElement('span')
    label.textContent = `${getDisplayLevelName(callbacks.projectConfig, node.depth)} · ${node.name}`
    const count = document.createElement('span')
    count.className = 'group-count'
    count.textContent = Lang.common.keys(getNodeRowCount(node))
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
        title.textContent = Lang.common.root
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
  usageReport?: TranslationUsageReport | null
  onMoveKey?: (sourceKey: string) => void
  onRemoveKey?: (key: string) => void
  onEditValue?: (change: { languageKey: string; key: string; value: string }) => boolean
  removedKeys?: string[]
}

export function renderTranslationTables(
  container: HTMLElement,
  bundle: I18nBundle,
  { projectConfig, usageReport, onMoveKey, onRemoveKey, onEditValue, removedKeys }: RenderTranslationOptions,
) {
  activeUsagePopover?.close()
  const document = container.ownerDocument
  const { languages, rows, currentKeyCount } = createRows(bundle, removedKeys)
  const normalizedLevelCount = Math.max(0, Number.isInteger(projectConfig?.levelCount) ? projectConfig.levelCount : 0)
  const tree = createGroupTree(rows, normalizedLevelCount)
  const fragment = document.createDocumentFragment()

  appendTableGroup(document, fragment, tree, languages, { projectConfig, usageReport, onMoveKey, onRemoveKey, onEditValue }, true)
  container.replaceChildren(fragment)
  return currentKeyCount
}
