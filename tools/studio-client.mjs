/**
 * Render the studio panel outside a browser.
 *
 * This is NOT React: it is the smallest hooks runtime that can drive the real
 * client.js through a mount / load / re-render cycle, so a broken render or a
 * bad state transition fails here instead of in the user's face.
 *
 *   node tools/client-harness.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = process.env.DSH_WEB_URL
if (!WEB) throw new Error('set DSH_WEB_URL to the running Web GUI URL')
const BASE = WEB.replace(/\/+$/, '') + '/'
// Paths are resolved from this file, so the project can move without edits.
const CLIENT = fileURLToPath(new URL('../packages/studio/client.js', import.meta.url))

/* ── minimal hooks runtime ── */
let current = null
const slots = new Map()
let effects = []
let dirty = false

const depsChanged = (a, b) => !a || !b || a.length !== b.length || a.some((it, i) => !Object.is(it, b[i]))

function createElement(type, props, ...children) {
  const flat = []
  const push = (child) => {
    if (child === null || child === undefined || child === false || child === true) return
    if (Array.isArray(child)) {
      for (const item of child) push(item)
      return
    }
    flat.push(child)
  }
  for (const child of children) push(child)
  if (props && 'children' in props) push(props.children)
  const merged = Object.assign({}, props)
  if (flat.length === 1) merged.children = flat[0]
  else if (flat.length > 1) merged.children = flat
  for (const key of Object.keys(merged)) if (key === 'children') continue
  return { el: true, type, props: merged, children: flat }
}

function slotFor(componentPath, index) {
  let record = slots.get(componentPath)
  if (!record) {
    record = { hooks: [] }
    slots.set(componentPath, record)
  }
  if (!record.hooks[index]) record.hooks[index] = {}
  return record.hooks[index]
}

function useState(initial) {
  const index = current.index++
  const slot = slotFor(current.path, index)
  if (!('value' in slot)) slot.value = typeof initial === 'function' ? initial() : initial
  const set = (next) => {
    const value = typeof next === 'function' ? next(slot.value) : next
    if (!Object.is(value, slot.value)) {
      slot.value = value
      dirty = true
    }
  }
  return [slot.value, set]
}

function useEffect(fn, deps) {
  const index = current.index++
  const slot = slotFor(current.path, index)
  if (depsChanged(slot.deps, deps)) {
    slot.deps = deps
    slot.fn = fn
    effects.push(slot)
  }
}

function useCallback(fn, deps) {
  const index = current.index++
  const slot = slotFor(current.path, index)
  if (!slot.fn || depsChanged(slot.deps, deps)) {
    slot.fn = fn
    slot.deps = deps
  }
  return slot.fn
}

const React = { createElement, useState, useEffect, useCallback }

/* ── render ── */
function render(node, key) {
  if (node === null || node === undefined || node === false || node === true) return null
  if (typeof node === 'string' || typeof node === 'number') return { text: String(node) }
  if (Array.isArray(node)) return { kids: node.map((child, i) => render(child, key + '/' + i)) }
  if (!node.el) return { text: String(node) }
  const { type, props } = node
  if (typeof type === 'function') {
    const name = type.name || 'anon'
    const previous = current
    current = { path: key + '/' + name, index: 0 }
    let output
    try {
      output = type(props)
    } catch (error) {
      current = previous
      throw new Error('render ' + name + ' failed: ' + error.message)
    }
    current = previous
    return render(output, key + '/' + name)
  }
  const kids = []
  for (let i = 0; i < node.children.length; i += 1) kids.push(render(node.children[i], key + '/' + i))
  return { tag: type, props, kids, text: undefined }
}

/* ── environment stubs ── */
const realFetch = globalThis.fetch
globalThis.fetch = (url, init) => realFetch(String(url).startsWith('http') ? url : BASE + url, init)
globalThis.window = { confirm: () => true }
globalThis.document = {
  head: { appendChild() {} },
  documentElement: {},
  getElementById: () => null,
  createElement: () => ({ set textContent(v) {}, set id(v) {} }),
}

/* ── load the module ── */
const source = fs.readFileSync(CLIENT, 'utf8')
let factory = null
const windowStub = {
  __ModuleLoader__: {
    load(config) {
      factory = config.factory
    },
  },
}
const run = new Function('window', 'document', 'fetch', 'TextEncoder', 'console', source)
run(windowStub, globalThis.document, globalThis.fetch, TextEncoder, console)

if (!factory) throw new Error('client.js never called __ModuleLoader__.load')
const plugin = factory((name) => (name === 'react' ? React : undefined))
if (typeof plugin.apply !== 'function') throw new Error('plugin has no apply()')

const registry = new Map()
plugin.apply({
  effect(fn) {
    const dispose = fn()
    return () => dispose && dispose()
  },
  locale: { register: () => () => {}, bind: () => undefined },
  theme: { getTheme: () => ({ active: { colorScheme: 'dark' } }) },
  on: () => {},
  slots: {
    inject: (name, fn) => fn(),
    register(definition, Component) {
      registry.set(definition.id || definition.key, Component)
      return () => {}
    },
  },
})

const Page = registry.get('studio')
if (!Page) throw new Error('panel did not register under main:studio')
if (!registry.get('studio')) throw new Error('sidebar entry did not register')

const tree = createElement(Page, {})
let output = null

async function runPasses() {
  let passes = 0
  for (passes = 0; passes < 10; passes += 1) {
    dirty = false
    effects = []
    output = render(tree, 'root')
    for (const slot of effects) slot.fn()
    await new Promise((resolve) => setTimeout(resolve, 150))
    if (!dirty) break
  }
  return passes + 1
}

function textOf(node) {
  if (!node) return ''
  if (typeof node.text === 'string') return node.text
  if (Array.isArray(node.kids)) return node.kids.map(textOf).join('')
  return ''
}

function findClickable(node, className, label, hits) {
  if (!node) return hits
  if (node.tag && node.props && node.props.className === className && textOf(node).indexOf(label) >= 0) hits.push(node)
  if (Array.isArray(node.kids)) for (const kid of node.kids) findClickable(kid, className, label, hits)
  return hits
}

function findTag(node, tag, hits) {
  if (!node) return hits
  if (node.tag === tag) hits.push(node)
  if (Array.isArray(node.kids)) for (const kid of node.kids) findTag(kid, tag, hits)
  return hits
}

async function click(className, label) {
  const hits = findClickable(output, className, label, [])
  if (hits.length === 0) throw new Error('cannot find ' + className + ' with text ' + label)
  hits[0].props.onClick({ stopPropagation() {}, preventDefault() {} })
  return runPasses()
}

function collect(node, bag) {
  if (!node) return bag
  if (typeof node.text === 'string') {
    bag.text.push(node.text)
    return bag
  }
  if (node.tag) {
    const cls = node.props && node.props.className
    if (cls) bag.classes.add(cls)
    for (const kid of node.kids || []) collect(kid, bag)
    return bag
  }
  if (Array.isArray(node.kids)) for (const kid of node.kids) collect(kid, bag)
  return bag
}

function snapshot() {
  const bag = collect(output, { text: [], classes: new Set() })
  return { flat: bag.text.join(' ').replace(/\s+/g, ' ').trim(), classes: bag.classes }
}

const problems = []
const expect = (ok, message) => {
  if (!ok) problems.push(message)
}

await runPasses()
let view = snapshot()
console.log('--- first render ---')
console.log(view.flat.slice(0, 500))

expect(view.flat.includes('预设工作室'), 'panel title missing')
expect(view.flat.includes('+ 新建预设'), 'the new-preset button missing')
expect(view.classes.has('dcm-gh'), 'no group headers rendered')
for (const label of ['注入', '文档', '技能', '工具', '文件']) {
  expect(view.flat.includes(label), 'missing group: ' + label)
}

const PRESET_ROOT = fileURLToPath(new URL('../预设', import.meta.url))
const presets = fs.readdirSync(PRESET_ROOT).filter((name) => fs.existsSync(path.join(PRESET_ROOT, name, 'cordis.patch.yml')))
expect(presets.length > 0, 'no preset on disk to render')
for (const name of presets) expect(view.flat.includes(name), 'picker lost the preset ' + name)

const installBtn = findClickable(output, 'dcm-btn', '装进 DSH', [])
const installedChip = findClickable(output, 'dcm-chip', '已装进 DSH', [])
if (installBtn.length === 0 && installedChip.length === 0) problems.push('neither install button nor installed chip')
if (installBtn.length > 0 && installedChip.length > 0) problems.push('install state shown twice')

const firstItem = findClickable(output, 'dcm-itemmain', '', [])
if (firstItem.length > 0) {
  await firstItem[0].props.onClick({ stopPropagation() {}, preventDefault() {} })
  await runPasses()
  view = snapshot()
  console.log('\n--- after opening the first entry ---')
  console.log(view.flat.slice(0, 300))
  expect(view.classes.has('dcm-editor'), 'opening an entry did not render the editor')
}

const addInject = findClickable(output, 'dcm-btn', '+ 注入', [])
if (addInject.length === 0) {
  problems.push('the 注入 create button is missing')
} else {
  await addInject[0].props.onClick({ stopPropagation() {}, preventDefault() {} })
  await runPasses()
  const after = snapshot()
  console.log('\n--- create form for 注入 ---')
  console.log(after.flat.slice(0, 500))
  expect(findTag(output, 'select', []).length === 1, 'the 落点 field must render a select, got ' + findTag(output, 'select', []).length)
  expect(after.flat.includes('系统提示词（常驻，最稳）'), 'the select lost its options')
  expect(after.flat.includes('按段位'), 'the 序号 hint is missing')
  expect(findTag(output, 'input', []).some((node) => node.props && node.props.type === 'number'), 'the 序号 field must be a number input')
}

if (problems.length > 0) {
  console.log('\nFAILED:')
  for (const item of problems) console.log(' -', item)
  process.exit(1)
}
console.log('\nOK: one page renders every entry type over the presets that exist')
process.exit(0)