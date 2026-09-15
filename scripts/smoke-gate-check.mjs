#!/usr/bin/env node
// 织卷冒烟门禁判据回归自检（平台层 2026-09-16 01:30 轮；docs/模块推进/03-平台层.md 第 25 轮候选 1）
// ---------------------------------------------------------------------------
// 背景：smoke-ui.mjs 两级门禁判据（①构建新鲜度 ②服务内容一致性，2026-09-15 22:30 轮 7676c47）
//       的「负向实证」当时只手动做过（临时脚本 + 手动 touch）——判据若被改坏（误放宽/写错条件），
//       --all 会静默回到旧假绿，且无任何信号。行业对应思想=变异测试（mutation testing）：
//       「故意注入缺陷，验证测试真的会红」——本脚本把手动实证固化为资产：自起假服务（bad/good 两个
//       变异体）+ 临时探针，断言两判据必 FAIL、恢复后必 PASS。
// 用法：node scripts/smoke-gate-check.mjs
//   前置：仓库已 npm run build（out/renderer/index.html 为构建事实源）；不依赖 8123/8899/CDP。
//   副作用：临时写入 scripts/_gate-*.mjs（运行后删除；中断残留不影响 --all，见 isSmoke 只认 smoke 字样）；
//           临时把 electron.vite.config.ts 与 out/renderer/index.html 的 mtime 前移/后移（内容零改动）。
// 退出码：0=全部断言过；1=有断言失败。
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url)) // scripts/
const repoRoot = resolve(SCRIPTS_DIR, '..')
const INDEX = join(repoRoot, 'out', 'renderer', 'index.html')
const FAKE_BODY = '<!doctype html><html><head><script src="/FAKE-bundle.js"></script></head><body><h1>old build</h1></body></html>'

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`✓ ${name}`) }
  else { failed++; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ---------- 前置 ----------
if (!existsSync(INDEX)) {
  console.error(`✗ 前置：无构建产物 ${INDEX}——请先 npm run build（门禁判据以它为构建事实源）`)
  process.exit(1)
}
// 清理历史残留探针（中断跑残留过）
for (const f of readdirSync(SCRIPTS_DIR)) if (/^_gate-.*\.mjs$/.test(f)) rmSync(join(SCRIPTS_DIR, f), { force: true })

// ---------- 起两个假服务（bad=旧构建内容；good=本地真实 index.html 内容） ----------
function serve(body) {
  return new Promise((res) => {
    const s = createServer((_req, rsp) => {
      rsp.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      rsp.end(body)
    })
    s.listen(0, '127.0.0.1', () => res(s))
  })
}
const srvBad = await serve(FAKE_BODY)
const srvGood = await serve(readFileSync(INDEX, 'utf8'))
const badUrl = `http://localhost:${srvBad.address().port}`
const goodUrl = `http://localhost:${srvGood.address().port}`

// ---------- 临时探针脚本（collectPorts 兜底识别 localhost 字面量即可） ----------
const probeBad = join(SCRIPTS_DIR, '_gate-bad.mjs')
const probeGood = join(SCRIPTS_DIR, '_gate-good.mjs')
writeFileSync(probeBad, `// 临时探针（smoke-gate-check 生成，测完删除——勿入 git）\nconst BASE = '${badUrl}'\n`)
writeFileSync(probeGood, `// 临时探针（smoke-gate-check 生成，测完删除——勿入 git）\nconst BASE = '${goodUrl}'\n`)

function runSmoke(arg) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [join(SCRIPTS_DIR, 'smoke-ui.mjs'), `${arg}.mjs`, '--list'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { out += d })
    const t = setTimeout(() => { p.kill('SIGKILL') }, 60000)
    p.on('close', (code) => { clearTimeout(t); res({ code: code ?? -1, out }) })
  })
}

try {
  // ① 判据 2（内容一致性）负向：bad 服务 refs ≠ 本地 → 必须 FAIL 且报因
  let r = await runSmoke('_gate-bad')
  check('判据2负向：旧构建内容必须 FAIL',
    r.code !== 0 && r.out.includes('服务内容与本地构建不一致'),
    `exit=${r.code}\n${r.out.slice(-600)}`)

  // ② 判据 2 正向：good 服务（=本地构建）必须 PASS
  r = await runSmoke('_gate-good')
  check('判据2正向：与本地构建一致必须 PASS',
    r.code === 0 && r.out.includes('全绿'),
    `exit=${r.code}\n${r.out.slice(-600)}`)

  // ③ 判据 1（构建新鲜度）负向：把 config 改成晚于产物 → 必须 FAIL 且报因（内容零改动，仅 mtime）
  const cfg = join(repoRoot, 'electron.vite.config.ts')
  const cfgM = statSync(cfg).mtimeMs
  const idxM = statSync(INDEX).mtimeMs
  utimesSync(cfg, new Date(idxM + 5000), new Date(idxM + 5000))
  r = await runSmoke('_gate-good')
  check('判据1负向：构建过期必须 FAIL',
    r.code !== 0 && r.out.includes('构建过期'),
    `exit=${r.code}\n${r.out.slice(-600)}`)

  // ④ 判据 1 恢复：把产物 mtime 提到最晚 → 必须 PASS（等效「重跑 npm run build 后」）
  utimesSync(INDEX, new Date(), new Date())
  r = await runSmoke('_gate-good')
  utimesSync(cfg, new Date(cfgM), new Date(cfgM)) // 还原 config mtime
  check('判据1恢复：产物最新必须 PASS',
    r.code === 0 && r.out.includes('全绿'),
    `exit=${r.code}\n${r.out.slice(-600)}`)
} finally {
  try { srvBad.close() } catch {}
  try { srvGood.close() } catch {}
  rmSync(probeBad, { force: true })
  rmSync(probeGood, { force: true })
}

console.log(`\n========== 门禁判据自检 ==========`)
console.log(`PASS ${passed} · FAIL ${failed}`)
process.exit(failed === 0 ? 0 : 1)
