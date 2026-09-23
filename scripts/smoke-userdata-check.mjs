#!/usr/bin/env node
// 织卷冒烟「数据层/userData 环境契约」守卫（平台层 2026-09-17 01:30 轮，候选 2 核销 + 资产化）
// ---------------------------------------------------------------------------
// 背景（候选 2 实测核销的证据，2026-09-17 01:30 盘点）：
//   electron-stub 默认 userData=/tmp/zj-smoke-userdata，若残留 zhijuan-settings.json（libraryRoot 指向
//   已删目录）会让数据层/真模型冒烟 libraryRoot() 定位空路径、readDoc 全 null = 冒烟「跑通却无内容」
//   假绿（2026-09-11 实踩坑；15 轮曾清污）。契约=每个引用 electron-stub 的脚本用**独立干净 userData**。
//   本轮全量盘点：52 个引用 electron-stub 的脚本全部带 ZJ_USERDATA，三形态均安全——
//   ① 固定独立目录 /tmp/zj-smoke-<名> + 启动 rmSync 清空；② mkdtempSync 全新目录（天然干净）；
//   ③ zj-bridge.mjs 固定 /tmp/zj-bridge-userdata（设计特例：answerDir() 与边车插件 ZJ_USER_ANSWER_DIR
//   须同目录、且从不读 settings——白名单豁免）。零缺口 → 候选 2 核销（㉕：重立候选前先实测核实）。
//   剩余风险=未来**新增**数据层冒烟忘设/忘清——本脚本=把契约从纪律变成资产（smoke-model-audit 同款
//   治理）；行业语义：pytest tmp_path fixture 提供「unique to each test function」临时目录（隔离为测试
//   框架一等纪律，docs.pytest.org/en/stable/how-to/tmp_path.html）；变异测试思想=判据自检固化成资产
//   （Stryker stryker-mutator.io；先例 scripts/smoke-gate-check.mjs）。
// 方法：扫描 scripts/ 顶层 .mjs 含 "electron-stub" 的脚本（与 grep -rl 同口径），按形态判定：
//   无 ZJ_USERDATA 赋值                → 硬缺口（共享默认目录=污染风险）
//   ZJ_USERDATA = '<字面量路径>'       → 必须含 rmSync(process.env.ZJ_USERDATA 启动清空（否则硬缺口）
//   ZJ_USERDATA = join(tmp,...)/mkdtemp → 干净（mkdtemp 每跑全新，天然隔离）
//   ZJ_USERDATA = <const 变量>(=绝对路径字面量) → 同变量 rmSync=干净；只赋未清=硬缺口（2026-09-21 19:30 平台层轮收口）
//   resetProbeUserdata()（lib/probe-settings.mjs 共享）→ 干净（2026-09-24 07:30 平台层轮适配：判据=调用存在
//     + 共享实现含 rmSync(dir) + 调用点位于 ZJ_USERDATA 赋值之后；9628ea8 迁移 67 探针后旧判据误报 11 硬缺口）
//   其他形态                            → 软提示「需人工核对」（出现即请核实）
//   白名单：zj-bridge.mjs（设计特例豁免，注释见上）
// 注意：sync-anchor-* 等脚本 bundle 纯函数、不引用 electron-stub 且不读 settings——不入扫描集（判据
//   按「引用 electron-stub」这一事实面，不误报）。
// 用法：
//   node scripts/smoke-userdata-check.mjs            # 审计（默认 exit 0；有硬缺口列清单）
//   node scripts/smoke-userdata-check.mjs --strict   # 有硬缺口 exit 1（门禁/CI 用）
//   node scripts/smoke-userdata-check.mjs --selfcheck  # 判据自检：临时探针+断言（变异测试思想，负向实证资产化）
// 维护：新增引用 electron-stub 的冒烟必须带独立 clean userData（固定目录+启动 rmSync 或 mkdtemp），
//   改本脚本判据后先跑 --selfcheck 再跑正常审计确认健康。
import { readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
// 元审计自排除（与 smoke-model-audit 的 SELF 同口径：不在扫描集的生命体；smoke-ui.mjs 头注/接入注释含
// "electron-stub" 字样但本身是门禁入口不引用桩——排除之，否则被误判硬缺口）
const SELF = ['smoke-userdata-check.mjs', 'smoke-ui.mjs']
// 设计特例白名单（逐条注明依据；新豁免必须补头注）
const EXEMPT = new Map([
  ['zj-bridge.mjs', '固定 /tmp/zj-bridge-userdata：answerDir() 与边车插件 ZJ_USER_ANSWER_DIR 须同目录（回灌一致），且从不读写 settings——19 轮已登记设计特例'],
])

// ---------- 核心：逐文件形态判定 ----------
// 返回 { file, kind: 'clean' | 'hard' | 'review', detail }

/** 共享清空路径（2026-09-24 07:30 平台层轮适配，误报根因见头注）：
 * probes 经 lib/probe-settings.mjs 的 resetProbeUserdata()（rmSync+mkdir+合并真机 llm 三步合一）
 * 清空——语义强于旧「rmSync 行」，但本审计旧判据只认 rmSync（9628ea8 迁移后 11 个探针误报 hard）。
 * 判据三连：①脚本确实调用 resetProbeUserdata(；②共享模块该函数实现确实含 rmSync(dir)（防实现
 * 退化=审计静默放行）；③调用点位于 ZJ_USERDATA 赋值之后（防「先 reset 后赋值」清错目录）。
 * 任一不满足→分别落到 review / review / hard，不许静默。 */
function lastUdAssign(content) {
  const re = /(?:process\.env\.)?ZJ_USERDATA\s*=/g
  let m
  let last = -1
  while ((m = re.exec(content))) last = m.index
  return last
}
function resetImplSafe() {
  try {
    const impl = readFileSync(join(SCRIPTS_DIR, 'lib/probe-settings.mjs'), 'utf8')
    const start = impl.indexOf('export function resetProbeUserdata')
    if (start === -1) return false
    const body = impl.slice(start)
    return /rmSync\s*\(\s*dir\b/.test(body) && /process\.env\.ZJ_USERDATA/.test(body)
  } catch {
    return false
  }
}
function assess(content, file) {
  const hasUd = /ZJ_USERDATA\s*=/.test(content)
  const resetCall = content.indexOf('resetProbeUserdata(')
  if (resetCall !== -1) {
    const assignAt = lastUdAssign(content)
    if (!hasUd || assignAt === -1 || assignAt > resetCall) {
      return { file, kind: 'hard', detail: '调用 resetProbeUserdata() 前未设 ZJ_USERDATA（或调用先于赋值）——共享清空会作用到旧值/共享默认目录，等于没清' }
    }
    if (!resetImplSafe()) {
      return { file, kind: 'review', detail: 'resetProbeUserdata() 共享实现未含 rmSync(process.env.ZJ_USERDATA) 清空——审计无法确认共享路径安全，请人工核对 lib/probe-settings.mjs' }
    }
    return { file, kind: 'clean', detail: '共享 resetProbeUserdata()（probe-settings 三步合一：rmSync+mkdir+合并 llm）' }
  }
  if (!hasUd) {
    return { file, kind: 'hard', detail: '未设置 ZJ_USERDATA——electron-stub 默认共享 /tmp/zj-smoke-userdata，残留 settings 会污染 libraryRoot→readDoc 全 null（假绿）' }
  }
  const literal = content.match(/ZJ_USERDATA\s*=\s*(['"])([^'"]*)\1/)
  if (literal) {
    // 启动清空判据：rmSync 目标须是 ZJ_USERDATA 本身或其 const 别名（先例：actgaps-data 等用
    //   const UD = process.env.ZJ_USERDATA; rmSync(UD,...)——别名链一层内识别）
    const aliases = [...content.matchAll(/const\s+(\w+)\s*=\s*process\.env\.ZJ_USERDATA/g)].map((m) => m[1])
    const targets = ['process.env.ZJ_USERDATA', 'ZJ_USERDATA', ...aliases]
    const cleaned = targets.some((t) => content.includes(`rmSync(${t}`))
    if (!cleaned) {
      return { file, kind: 'hard', detail: `固定目录 ${literal[2]} 但无启动 rmSync 清空——残留 settings 仍会污染（须紧接 ZJ_USERDATA 赋值后 rmSync(process.env.ZJ_USERDATA,{recursive:true,force:true})）` }
    }
    return { file, kind: 'clean', detail: '固定独立目录+启动清空' }
  }
  if (/mkdtempSync/.test(content) || /ZJ_USERDATA\s*=\s*join\(tmp/.test(content)) {
    return { file, kind: 'clean', detail: 'mkdtemp 全新目录（天然干净）' }
  }
  // 变量形态（2026-09-21 19:30 平台层轮收口）：const X = '<绝对路径>'; ZJ_USERDATA = X; rmSync(X)
  // ——与字面量同安全（先例 skill-manage-smoke.mjs，还带 settings 定向）；判据=同一变量既赋 ZJ_USERDATA 又被 rmSync；
  // 只赋未清=硬缺口（与固定目录无 rmSync 同权），未识别=review 人工核对。
  for (const m of content.matchAll(/const\s+(\w+)\s*=\s*(['"])([^'"]*)\2/g)) {
    const [, vname, , vpath] = m
    if (!vpath.startsWith('/')) continue
    const assignRe = new RegExp(`(?:ZJ_USERDATA|process\\.env\\.ZJ_USERDATA)\\s*=\\s*${vname}\\b`)
    const rmRe = new RegExp(`rmSync\\(\\s*${vname}\\b`)
    if (assignRe.test(content)) {
      if (rmRe.test(content)) {
        return { file, kind: 'clean', detail: 'const 变量字面量（绝对路径）+ 同变量启动清空' }
      }
      return { file, kind: 'hard', detail: `变量形态 ${vpath} 无启动 rmSync 清空——残留 settings 仍会污染（须紧接 ZJ_USERDATA 赋值后 rmSync(<变量>,{recursive:true,force:true})）` }
    }
  }
  return { file, kind: 'review', detail: '其他形态（非字面量/非 mkdtemp）——请人工核对 userData 隔离性' }
}

export function analyze() {
  const allFiles = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith('.mjs') || f.endsWith('.mts')).sort()
  const stubFiles = allFiles.filter((f) => !SELF.includes(f) && (() => {
    try {
      return readFileSync(join(SCRIPTS_DIR, f), 'utf8').includes('electron-stub')
    } catch {
      return false
    }
  })())
  const hard = []
  const review = []
  const clean = []
  const exempt = []
  for (const f of stubFiles) {
    if (EXEMPT.has(f)) {
      exempt.push(f)
      continue
    }
    const r = assess(readFileSync(join(SCRIPTS_DIR, f), 'utf8'), f)
    if (r.kind === 'hard') hard.push(r)
    else if (r.kind === 'review') review.push(r)
    else clean.push(r)
  }
  return { allFiles, stubFiles, hard, review, clean, exempt }
}

export function report({ stubFiles, hard, review, clean, exempt }) {
  console.log('数据层 userData 环境契约审计 · 扫描完成')
  if (hard.length === 0 && review.length === 0) {
    console.log(`✅ 健康：${stubFiles.length} 个引用 electron-stub 的脚本全部带独立 clean userData（${clean.length} 合规${exempt.length ? ` + ${exempt.length} 白名单豁免（${exempt.join('、')}）` : ''}）— 契约有守卫，新增忘设/忘清当刻现形`)
    return true
  }
  for (const h of hard) {
    console.log(`❌ [硬缺口·userData 未隔离] ${h.file} — ${h.detail}`)
    console.log('     → 处置：ZJ_USERDATA 指向独立目录（/tmp/zj-smoke-<名>）并紧接 rmSync(process.env.ZJ_USERDATA,{recursive:true,force:true}) 清空，或改 mkdtempSync 全新目录（sync-anchor 先例）')
  }
  for (const r of review) {
    console.log(`⚠️  [需人工核对] ${r.file} — ${r.detail}`)
  }
  return false
}

// ---------- --selfcheck：临时探针 + 断言（自建自删，负向实证资产化） ----------
function selfcheck() {
  let ok = 0
  let bad = 0
  const probeA = join(SCRIPTS_DIR, '_ud-probe-a-smoke.mjs') // 引用 stub + 无 ZJ_USERDATA → 必判硬缺口
  const probeB = join(SCRIPTS_DIR, '_ud-probe-b-smoke.mjs') // 引用 stub + 固定目录无 rmSync → 必判硬缺口
  const probeC = join(SCRIPTS_DIR, '_ud-probe-c-smoke.mjs') // 引用 stub + mkdtemp → 必不提示
  const probeD = join(SCRIPTS_DIR, '_ud-probe-d-smoke.mjs') // 引用 stub + 变量形态（const 绝对路径+同变量 rmSync+ZJ_USERDATA=变量）→ 必不提示
  const probeE = join(SCRIPTS_DIR, '_ud-probe-e-smoke.mjs') // 引用 stub + 变量形态但忘 rmSync → 必判硬缺口
  const probeF = join(SCRIPTS_DIR, '_ud-probe-f-smoke.mjs') // 引用 stub + 赋值后调 resetProbeUserdata() → 必不提示（共享路径，2026-09-24 07:30）
  const probeG = join(SCRIPTS_DIR, '_ud-probe-g-smoke.mjs') // 引用 stub + resetProbeUserdata() 先于赋值 → 必判硬缺口（清错目录）
  const assert = (name, cond) => {
    console.log(`  ${cond ? '✓' : '✗'} ${name}`)
    cond ? ok++ : bad++
  }
  try {
    writeFileSync(probeA, "// 临时探针 A（自检用，跑完即删）：引用 electron-stub 但忘设 ZJ_USERDATA\nimport x from 'electron-stub'\nvoid x\n")
    writeFileSync(probeB, "// 临时探针 B（自检用，跑完即删）：固定目录但忘清空\nprocess.env.ZJ_USERDATA = '/tmp/zj-smoke-probe-b'\nimport x from 'electron-stub'\nvoid x\n")
    writeFileSync(probeC, "// 临时探针 C（自检用，跑完即删）：mkdtemp 干净形态\nimport { mkdtempSync } from 'node:fs'\nconst tmp = mkdtempSync('/tmp/zj-ud-probe-')\nprocess.env.ZJ_USERDATA = tmp\nimport x from 'electron-stub'\nvoid x\n")
    writeFileSync(probeD, "// 临时探针 D（自检用，跑完即删）：变量形态干净（const 绝对路径+同变量 rmSync+ZJ_USERDATA=变量）\nconst ud = '/tmp/zj-ud-probe-d'\nimport { rmSync } from 'node:fs'\nrmSync(ud, { recursive: true, force: true })\nprocess.env.ZJ_USERDATA = ud\nimport x from 'electron-stub'\nvoid x\n")
    writeFileSync(probeE, "// 临时探针 E（自检用，跑完即删）：变量形态但忘 rmSync\nconst ud = '/tmp/zj-ud-probe-e'\nprocess.env.ZJ_USERDATA = ud\nimport x from 'electron-stub'\nvoid x\n")
    writeFileSync(probeF, "// 临时探针 F（自检用，跑完即删）：共享 resetProbeUserdata 干净形态\nimport { resetProbeUserdata } from './lib/probe-settings.mjs'\nprocess.env.ZJ_USERDATA = '/tmp/zj-ud-probe-f'\nresetProbeUserdata()\nimport x from 'electron-stub'\nvoid x\n")
  writeFileSync(probeG, "// 临时探针 G（自检用，跑完即删）：reset 先于赋值=清错目录\nimport { resetProbeUserdata } from './lib/probe-settings.mjs'\nresetProbeUserdata()\nprocess.env.ZJ_USERDATA = '/tmp/zj-ud-probe-g'\nimport x from 'electron-stub'\nvoid x\n")
  let r = analyze()
    assert('引用 stub 忘设 ZJ_USERDATA 被列硬缺口（正向 A）', r.hard.some((h) => h.file === '_ud-probe-a-smoke.mjs'))
    assert('固定目录无启动清空被列硬缺口（正向 B）', r.hard.some((h) => h.file === '_ud-probe-b-smoke.mjs'))
    assert('mkdtemp 干净形态不被提示（负向 C）', !r.hard.some((h) => h.file === '_ud-probe-c-smoke.mjs') && !r.review.some((h) => h.file === '_ud-probe-c-smoke.mjs'))
    assert('变量形态干净不被提示（负向 D）', !r.hard.some((h) => h.file === '_ud-probe-d-smoke.mjs') && !r.review.some((h) => h.file === '_ud-probe-d-smoke.mjs'))
    assert('变量形态忘清空被列硬缺口（正向 E）', r.hard.some((h) => h.file === '_ud-probe-e-smoke.mjs'))
    assert('共享 resetProbeUserdata 干净形态不被提示（负向 F）', !r.hard.some((h) => h.file === '_ud-probe-f-smoke.mjs') && !r.review.some((h) => h.file === '_ud-probe-f-smoke.mjs'))
    assert('reset 先于赋值（清错目录）被列硬缺口（正向 G）', r.hard.some((h) => h.file === '_ud-probe-g-smoke.mjs'))
    assert('zj-bridge 白名单豁免不被提示', !r.hard.some((h) => h.file === 'zj-bridge.mjs'))
  } finally {
    rmSync(probeA, { force: true })
    rmSync(probeB, { force: true })
    rmSync(probeC, { force: true })
    rmSync(probeD, { force: true })
    rmSync(probeE, { force: true })
    rmSync(probeF, { force: true })
    rmSync(probeG, { force: true })
  }
  const r2 = analyze()
  assert('清理探针后回到健康基线（无硬缺口/需核对）', r2.hard.length === 0 && r2.review.length === 0)
  console.log(`\n--selfcheck：${ok} 项通过${bad ? `，${bad} 项失败 ❌（探针已清理）` : '，判据自检通过 ✅'}`)
  return bad === 0
}

// ---------- 主流程（仅 CLI 直跑时执行；被 smoke-ui.mjs import 时只取 analyze/report） ----------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
  const args = process.argv.slice(2)
  if (args.includes('--selfcheck')) {
    process.exit(selfcheck() ? 0 : 1)
  }
  const healthy = report(analyze())
  if (!healthy && args.includes('--strict')) {
    console.log('--strict：存在硬缺口，退出码 1（补齐并重跑）')
    process.exit(1)
  }
  if (!healthy && !args.includes('--strict')) {
    console.log('（默认只提示不阻断：--strict 可让门禁/CI 对硬缺口报 exit 1）')
  }
  process.exit(0)
}
