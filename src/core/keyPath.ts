export type KeyPathSegment = string | number

export type KeyPathResult =
  | { found: false }
  | { found: true; value: unknown }

type MutableContainer = Record<PropertyKey, unknown> | unknown[]

function isContainer(value: unknown): value is MutableContainer {
  return value !== null && typeof value === 'object'
}

function asRecord(value: MutableContainer): Record<PropertyKey, unknown> {
  return value as unknown as Record<PropertyKey, unknown>
}

export function parseKeyPath(key: string, parameterName: string): KeyPathSegment[] {
  if (key.trim() === '') {
    throw new Error(`${parameterName} must be a non-empty key.`)
  }

  const segments: KeyPathSegment[] = []
  const matcher = /(?:^|\.)([^.[\]]+)|\[(\d+)\]/g
  let match: RegExpExecArray | null
  let matchedCharacters = ''

  while ((match = matcher.exec(key)) !== null) {
    segments.push(match[2] === undefined ? match[1]! : Number(match[2]))
    matchedCharacters += match[0]
  }

  if (segments.length === 0 || matchedCharacters !== key) {
    throw new Error(`${parameterName} contains an invalid path: ${key}`)
  }

  return segments
}

export function getKeyPathValue(root: unknown, segments: KeyPathSegment[]): KeyPathResult {
  let current = root

  for (const segment of segments) {
    if (!isContainer(current) || !Object.hasOwn(current, segment)) return { found: false }
    current = asRecord(current)[segment]
  }

  return { found: true, value: current }
}

export function deleteKeyPathValue(root: MutableContainer, segments: KeyPathSegment[]): void {
  const containers: Array<{ container: MutableContainer; segment: KeyPathSegment }> = []
  let parent: MutableContainer = root

  for (const segment of segments.slice(0, -1)) {
    containers.push({ container: parent, segment })
    const nested = asRecord(parent)[segment]
    if (!isContainer(nested)) throw new Error(`The key path is invalid at ${String(segment)}.`)
    parent = nested
  }
  const property = segments.at(-1)!
  if (Array.isArray(parent) && typeof property === 'number') parent.splice(property, 1)
  else delete asRecord(parent)[property]

  for (let index = containers.length - 1; index >= 0; index -= 1) {
    const { container, segment } = containers[index]!
    const child = asRecord(container)[segment]
    if (!isContainer(child) || Object.keys(child).length > 0) break
    if (Array.isArray(container) && typeof segment === 'number') container.splice(segment, 1)
    else delete asRecord(container)[segment]
  }
}

export function setKeyPathValue(
  root: MutableContainer,
  segments: KeyPathSegment[],
  value: unknown,
): void {
  const property = segments.at(-1)!
  let current: MutableContainer = root

  segments.slice(0, -1).forEach((segment, index) => {
    if (!Object.hasOwn(current, segment)) {
      asRecord(current)[segment] = typeof segments[index + 1] === 'number' ? [] : {}
    }

    const nested = asRecord(current)[segment]
    if (!isContainer(nested)) {
      throw new Error(`The destination key cannot be created inside ${String(segment)}.`)
    }

    current = nested
  })

  asRecord(current)[property] = value
}
