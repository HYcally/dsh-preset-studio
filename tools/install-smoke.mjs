/**
 * Simulate an *installed* copy: a package with no checkout around it.
 * Runs the real routes with an empty config, then creates a preset from the
 * template that ships inside the package.
 *
 *   node tools/install-smoke.mjs             # copies packages/studio to a temp dir
 *   node tools/install-smoke.mjs <pkg dir>   # or point it at a copy you made
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SOURCE = fileURLToPath(new URL('../packages/studio', import.meta.url))
const scratch = process.argv[2] ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'studio-install-'))
const PKG = process.argv[2] || path.join(scratch, 'pkg')
if (!process.argv[2]) fs.cpSync(SOURCE, PKG, { recursive: true })

const mod = await import(pathToFileURL(path.join(PKG, 'index.js')).href)
const routes = new Map()
const ctx = {
  logger: { info: () => {}, warn: () => {} },
  webServer: {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  },
  effect: (fn) => fn(),
  get: () => undefined,
}

// The whole point: no config at all — exactly what an installed bundle gets.
mod.apply(ctx, {})

const call = async (method, routePath, payload) => {
  const route = routes.get(routePath.split('?')[0])
  if (!route) throw new Error('no route ' + routePath)
  const req = Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload), 'utf8')])
  req.method = method
  req.url = routePath
  req.socket = { remoteAddress: '127.0.0.1' }
  let status = 0
  let body = ''
  await route.handler(req, {
    writeHead(code) { status = code },
    end(chunk) { body = String(chunk) },
  })
  let json = null
  try { json = JSON.parse(body) } catch {}
  return { status, json, body }
}

const problems = []
const expect = (ok, msg) => { if (!ok) problems.push(msg) }

const listed = await call('GET', mod.ROUTES.presets)
expect(listed.status === 200, 'presets route failed: ' + listed.body)
const root = (listed.json.roots || [])[0] || ''
console.log('roots    :', JSON.stringify(listed.json.roots))
console.log('template :', JSON.stringify(listed.json.template))
expect(root !== '', 'an installed copy must still have a root')
expect(fs.existsSync(root), 'the default root is not on disk: ' + root)
expect(!root.toLowerCase().includes('sm-studio'), 'an installed copy must not default to the checkout')
expect(listed.json.template && listed.json.template.exists === true, 'the shipped template was not found')

const dir = path.join(root, '安装冒烟')
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })

const created = await call('POST', mod.ROUTES.presetCreate, { title: '安装冒烟', id: 'install-smoke' })
if (created.status !== 200) console.log('create   :', created.status, created.body)
expect(created.status === 200, 'creating a preset from the shipped template failed')
if (fs.existsSync(dir)) {
  const patch = fs.readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8')
  expect(patch.includes("name: 'dsh-preset-studio/inject'"), 'the created preset lost the injector row')
  expect(patch.includes("name: 'dsh-preset-studio/docs'"), 'the created preset lost the write-back row')
  expect(!patch.includes('__DIR__'), 'the placeholders were not replaced')
  expect(fs.existsSync(path.join(dir, 'package.json')), 'the created preset has no package.json')
  expect(!fs.existsSync(path.join(dir, '模板说明.md')), 'the template guide leaked into the preset')
  // the panel must consider this preset wired
  const again = await call('GET', mod.ROUTES.presets)
  const made = (again.json.presets || []).find((p) => p.dir === dir)
  expect(made && made.entries.inject.wiring.wired === true, 'a fresh preset reports unwired: inject')
  expect(made && made.entries.doc.wiring.wired === true, 'a fresh preset reports unwired: docs')
  expect(made && made.entries.skill.wiring.wired === true, 'a fresh preset reports unwired: skills')
  fs.rmSync(dir, { recursive: true, force: true })
}

if (problems.length) {
  console.log('\nFAILED')
  for (const p of problems) console.log('  - ' + p)
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true })
  process.exit(1)
}
if (scratch) fs.rmSync(scratch, { recursive: true, force: true })
console.log('\nOK: an installed copy finds its own template, gets a root, and creates a wired preset')
