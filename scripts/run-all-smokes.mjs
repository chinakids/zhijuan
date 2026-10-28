// 全量冒烟 runner：并发跑 scripts/*smoke*.mjs，记录退出码与结果行
import { readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const root = '/Users/chinakids/Desktop/织卷'
const dir = join(root, 'scripts')
const files = readdirSync(dir).filter((f) => f.includes('smoke') && f.endsWith('.mjs') && f !== 'run-all-smokes.mjs').sort()
const report = '/tmp/zj-smoke-report.tsv'
writeFileSync(report, '')
console.log(`[runner] ${files.length} scripts, concurrency=4`)

const concurrency = 1
let idx = 0
let done = 0
const results = []

function runOne(file) {
  return new Promise((resolve) => {
    const start = Date.now()
    const p = spawn('node', [join(dir, file)], { cwd: root, env: process.env })
    let out = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { out += d })
    const timer = setTimeout(() => { try { p.kill('SIGKILL') } catch {} }, 150_000)
    p.on('close', (code) => {
      clearTimeout(timer)
      const ms = Date.now() - start
      const last = (out.match(/RESULT[^\n]*|ALL PASS[^\n]*|ALL OK[^\n]*|pass=\d+ fail=\d+[^\n]*|FATAL[^\n]*/g) || []).slice(-1)[0] || ''
      const status = code === 0 ? 'PASS' : 'FAIL'
      const line = `${file}\t${status}\t${code}\t${ms}ms\t${last.slice(0, 120)}`
      appendFileSync(report, line + '\n')
      results.push({ file, status, code, ms, last })
      done++
      if (done % 20 === 0) console.log(`[runner] ${done}/${files.length} done`)
      resolve()
    })
  })
}

async function cleanupTabs() {
  try {
    const list = await (await fetch('http://127.0.0.1:9224/json/list')).json()
    for (const t of list.slice(1)) {
      try { await fetch('http://127.0.0.1:9224/json/close/' + t.id) } catch {}
    }
  } catch {}
}

async function worker() {
  while (idx < files.length) {
    const f = files[idx++]
    await runOne(f)
    if (done % 25 === 0) await cleanupTabs()
  }
}
await Promise.all(Array.from({ length: concurrency }, worker))
const fail = results.filter((r) => r.status === 'FAIL')
console.log(`[runner] DONE total=${files.length} pass=${files.length - fail.length} fail=${fail.length}`)
if (fail.length) {
  console.log('[runner] FAILS:')
  for (const f of fail) console.log(`  ${f.file} (exit ${f.code}) ${f.last.slice(0, 80)}`)
}