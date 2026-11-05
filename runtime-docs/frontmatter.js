/**
 * Frontmatter readers shared by the panel's host routes and the injector.
 *
 * Top-level scalars only, and every other byte of the file is preserved: the
 * panel edits frontmatter by rewriting one line, never by re-serializing YAML.
 */

/** Split a markdown file into frontmatter head and the rest, or null without one. */
export function splitFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/.exec(text)
  if (!match) return null
  return { head: match[1], rest: text.slice(match[0].length), eol: text.includes('\r\n') ? '\r\n' : '\n' }
}

/** Read one top-level scalar out of the frontmatter head. */
export function readField(head, key) {
  const re = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*(.*)$', 'm')
  const match = re.exec(head)
  if (!match) return undefined
  let value = match[1].trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  return value
}

/** The boolean spellings the provider accepts. */
export function readBoolean(value) {
  if (value === undefined) return undefined
  const text = String(value).trim().toLowerCase()
  if (['true', 'yes', 'on', '1'].includes(text)) return true
  if (['false', 'no', 'off', '0'].includes(text)) return false
  return undefined
}

/** Read one top-level number out of the frontmatter head. */
export function readNumber(head, key) {
  const raw = readField(head, key)
  if (raw === undefined || raw === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}
