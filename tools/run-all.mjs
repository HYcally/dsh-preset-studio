/**
 * Run every harness in one command.
 *
 *   node tools/run-all.mjs
 *
 * The client harness talks to a running DSH, so it is skipped (not failed) when
 * DSH_WEB_URL is not set — CI can run this without a harness in the loop.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const cases = [
  { file: 'studio-flow.mjs', needsDsh: false },
  { file: 'install-smoke.mjs', needsDsh: false },
  { file: 'injector-test.mjs', needsDsh: false },
  { file: 'studio-client.mjs', needsDsh: true },
]

let failed = 0
let skipped = 0
for (const item of cases) {
  if (item.needsDsh && !process.env.DSH_WEB_URL) {
    console.log('\n== SKIP ' + item.file + ' (set DSH_WEB_URL to run it) ==')
    skipped += 1
    continue
  }
  console.log('\n== RUN ' + item.file + ' ==')
  const result = spawnSync(process.execPath, [path.join(here, item.file)], { stdio: 'inherit' })
  if (result.status !== 0) {
    failed += 1
    console.log('== FAIL ' + item.file + ' (exit ' + result.status + ') ==')
  }
}

console.log('\n' + (failed === 0 ? 'ALL PASSED' : failed + ' FAILED') + ' · ' + skipped + ' skipped')
process.exit(failed === 0 ? 0 : 1)
