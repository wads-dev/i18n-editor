import { getDefaultLevelImport } from '@wads.dev/i18n-ts/config'
import { getEditorLevelName } from '../core/projectConfig.js'

function getDisplayLevelName(config, index) {
  const configured = getEditorLevelName(config, index)
  return configured === `Level ${index}` ? Lang.common.level(index) : configured
}

function createJsonField(document, { labelText, value, placeholder, onInput }) {
  const label = document.createElement('label')
  label.className = 'level-field level-json-field'

  const title = document.createElement('span')
  title.textContent = labelText

  const textarea = document.createElement('textarea')
  textarea.spellcheck = false
  textarea.value = JSON.stringify(value || {}, null, 2)
  textarea.placeholder = placeholder
  textarea.addEventListener('input', () => onInput(textarea.value))

  label.append(title, textarea)
  return label
}

export function renderLevelImportFields(container, config, onChange) {
  const document = container.ownerDocument
  const fragment = document.createDocumentFragment()

  for (let index = 0; index <= config.levelCount; index += 1) {
    const levelImport = config.levelImports[index] || getDefaultLevelImport(index)
    const card = document.createElement('section')
    card.className = 'level-import-card'

    const heading = document.createElement('h4')
    heading.textContent = index === 0
      ? `${Lang.common.root} (${Lang.common.level(0).toLocaleLowerCase()})`
      : `${getDisplayLevelName(config, index)} (${Lang.common.level(index).toLocaleLowerCase()})`

    const pathLabel = document.createElement('label')
    pathLabel.className = 'level-field level-path-field'
    const pathTitle = document.createElement('span')
    pathTitle.textContent = Lang.settings.pathTemplate
    const pathInput = document.createElement('input')
    pathInput.type = 'text'
    pathInput.value = levelImport.path
    pathInput.placeholder = getDefaultLevelImport(index).path
    pathInput.addEventListener('input', () => onChange(index, 'path', pathInput.value))
    pathLabel.append(pathTitle, pathInput)

    card.append(heading, pathLabel)
    if (index > 0) {
      const replacers = document.createElement('div')
      replacers.className = 'level-replacers'
      replacers.append(
        createJsonField(document, {
          labelText: `${Lang.settings.valueReplacer} (JSON)`,
          value: levelImport.valueReplacer,
          placeholder: '{ "module.feature": "folder-name" }',
          onInput: (value) => onChange(index, 'valueReplacer', value),
        }),
        createJsonField(document, {
          labelText: `${Lang.settings.fullReplacer} (JSON)`,
          value: levelImport.fullReplacer,
          placeholder: '{ "module.feature": "@/custom/path" }',
          onInput: (value) => onChange(index, 'fullReplacer', value),
        }),
      )
      card.append(replacers)
    }

    fragment.append(card)
  }

  container.replaceChildren(fragment)
}
