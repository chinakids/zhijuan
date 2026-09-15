#!/usr/bin/env node
// 织卷冒烟「模型类名单」漏网守卫（平台层 2026-09-16 04:30 轮，观察项 ㉔ 机械化）
// ---------------------------------------------------------------------------
// 背景：真人驱动的冒烟=依赖 vLLM 算力池忙闲（非代码红/绿判据），MODEL_SCRIPTS 显式名单让 --all 门禁
//       跳过它们（16:30 轮收口）。但名单是**人工维护**的：新增真模型冒烟若忘记登记 → --all 会把它
//       跑进门禁 → 因模型侧波动恒红（基线 13:30 实锤 acts/engine-sync 全量 300s 被杀=误杀）= 门禁
//       「全绿」信号被侵蚀。本脚本=把「新增必须登记」从人盯变成自动审计。
// 方法：静态启发扫描 scripts/ 中 isSmoke 集合（与 smoke-ui.mjs 同口径）∪ MODEL_SCRIPTS 成员，
//       按强/弱特征串判命中，与名单求差集：
//         · 未登记且特征命中          → 疑似漏网（提示人工核对调用面，再登记到 model-scripts.mjs）
//         · 已登记但零特征命中         → 反向提示（可能已改写成无模型逻辑/特征词变了，人工复核）
//         · 已人工核对（REVIEWED_NON_MODEL）绝不提示
//       判据说明：强特征=几乎必然真模型；弱特征（runChat/runSync/真模型 等）会命中无模型的数据层/UI
//       冒烟（guard-issues-3entry/sync-anchor/sync-guard/sync-produce-loop/project-ctx 实核均非模型类，
//       已进 REVIEWED_NON_MODEL）——启发式无法 100% 判定，**只提示不阻断**，最终判定仍需人工，与
//       pytest --strict-markers（未登记 mark 报错，docs.pytest.org/en/stable/how-to/mark.html）同构：
//       登记制强制是工业标准方向，但 strict 前置=「声明即注册」（mark 写在测试代码上），本场景声明在
//       名单、特征在代码，启发式有噪点故取「审计提示 + --strict 可选阻断」。
// 用法：
//   node scripts/smoke-model-audit.mjs            # 审计（0 疑似=健康；默认 exit 0）
//   node scripts/smoke-model-audit.mjs --strict   # 有疑似漏网 exit 1（门禁/CI 用）
//   node scripts/smoke-model-audit.mjs --selfcheck  # 判据自检：临时探针+差集断言（变异测试思想，
//                                                  #   负向实证固化成资产——smoke-gate-check 同模式）
// 维护：改 model-scripts.mjs（名单/特征/人工核对集）后先跑本脚本确认健康；新真模型冒烟合入名单后必跑。
import { readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL_SCRIPTS, REVIEWED_NON_MODEL, STRONG_MARKERS, WEAK_MARKERS } from './model-scripts.mjs'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
// isSmoke 与 smoke-ui.mjs 同口径（递归排除入口本身与门禁自检——均为不在名单的生命体）
const SELF = ['smoke-ui.mjs', 'smoke-gate-check.mjs', 'smoke-model-audit.mjs']
const isSmoke = (f) => /smoke/i.test(f) && !SELF.includes(f)

// ---------- 核心：逐文件特征命中 ----------
function hitMarkers(content) {
  const hits = []
  const lines = content.split('\n')
  for (const m of STRONG_MARKERS) {
    const idx = lines.findIndex((l) => l.includes(m))
    if (idx >= 0) hits.push({ marker: m, strong: true, line: idx + 1 })
  }
  for (const m of WEAK_MARKERS) {
    const idx = lines.findIndex((l) => l.includes(m))
    if (idx >= 0) hits.push({ marker: m, strong: false, line: idx + 1 })
  }
  return hits
}

function analyze() {
  const allFiles = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith('.mjs')).sort()
  const files = new Set([...allFiles.filter(isSmoke), ...MODEL_SCRIPTS]) // 名单成员即使改名不在 isSmoke 也检查
  const leak = [] // 疑似漏网：未登记 + 未人工核对 + 特征命中
  const zeroHit = [] // 名单成员零特征（反向腐化）
  const reviewedAbsent = [...REVIEWED_NON_MODEL].filter((f) => !allFiles.includes(f))
  for (const f of files) {
    const content = readFileSync(join(SCRIPTS_DIR, f), 'utf8')
    const hits = hitMarkers(content)
    if (MODEL_SCRIPTS.has(f)) {
      if (hits.length === 0) zeroHit.push(f)
    } else if (!REVIEWED_NON_MODEL.has(f) && hits.length > 0) {
      leak.push({ file: f, hits })
    }
  }
  return { allFiles, leak, zeroHit, reviewedAbsent }
}

function report({ leak, zeroHit, reviewedAbsent }) {
  console.log('模型类名单审计 · 扫描完成')
  if (leak.length === 0 && zeroHit.length === 0 && reviewedAbsent.length === 0) {
    console.log('✅ 健康：无疑似漏网、名单成员均有特征命中、人工核对集与 scripts/ 一致（MODEL_SCRIPTS ' + MODEL_SCRIPTS.size + ' / REVIEWED_NON_MODEL ' + REVIEWED_NON_MODEL.size + '）')
    return true
  }
  for (const l of leak) {
    const kind = l.hits.some((h) => h.strong) ? '强' : '弱'
    console.log(`⚠️  [${kind}特征·疑似漏网] ${l.file} — 命中: ${l.hits.map((h) => `${h.marker}(L${h.line})`).join(', ')}`)
    console.log(`     → 若确为真模型驱动：请人工核对调用面（跑一次看是否调引擎/边车）后登记到 scripts/model-scripts.mjs；若确非模型类：加入 REVIEWED_NON_MODEL 并注明理由`)
  }
  for (const f of zeroHit) console.log(`⚠️  [名单零特征] ${f} — 已登记但强/弱特征零命中：可能已改写为无模型逻辑或特征词变更，请人工复核（仍在 MODEL_SCRIPTS=门禁仍跳过它）`)
  for (const f of reviewedAbsent) console.log(`⚠️  [人工核对集腐化] ${f} — REVIEWED_NON_MODEL 中不存在于 scripts/（脚本已删/改名请清理）`)
  return false
}

// ---------- --selfcheck：临时探针 + 差集断言（自建自删，负向实证资产化） ----------
function selfcheck() {
  let ok = 0
  let bad = 0
  const probeA = join(SCRIPTS_DIR, '_model-probe-a-smoke.mjs') // 强特征+未登记 → 必被列为疑似漏网
  const probeB = join(SCRIPTS_DIR, '_model-probe-clean-smoke.mjs') // 无特征+未登记 → 必不提示
  const assert = (name, cond) => {
    console.log(`  ${cond ? '✓' : '✗'} ${name}`)
    cond ? ok++ : bad++
  }
  try {
    writeFileSync(probeA, '// 临时探针 A（自检用，跑完即删）：模拟新增真模型驱动冒烟未登记\n// runSubtask 真模型调用 + LOCAL_LLM_KEY 本地 llm\nconst LOCAL_LLM_KEY = "local"\nvoid runSubtask\n')
    writeFileSync(probeB, '// 临时探针 B（自检用，跑完即删）：无特征的普通冒烟\nconsole.log("hello")\n')
    let r = analyze()
    assert('未登记强特征探针被列为疑似漏网（正向）', r.leak.some((l) => l.file === '_model-probe-a-smoke.mjs'))
    assert('未登记无特征探针不被提示（负向）', !r.leak.some((l) => l.file === '_model-probe-clean-smoke.mjs'))
    assert('正常基线脚本不被误报（REVIEWED_NON_MODEL 生效）', !r.leak.some((l) => l.file === 'sync-produce-loop-smoke.mjs'))
  } finally {
    rmSync(probeA, { force: true })
    rmSync(probeB, { force: true })
  }
  const r2 = analyze()
  assert('清理探针后回到健康基线（无疑似漏网）', r2.leak.length === 0)
  assert('名单成员均有特征命中（反向腐化为空）', r2.zeroHit.length === 0)
  console.log(`\n--selfcheck：${ok} 项通过${bad ? `，${bad} 项失败 ❌（探针已清理）` : '，判据自检通过 ✅'}`)
  return bad === 0
}

// ---------- 主流程 ----------
const args = process.argv.slice(2)
if (args.includes('--selfcheck')) {
  process.exit(selfcheck() ? 0 : 1)
}
const healthy = report(analyze())
if (!healthy && args.includes('--strict')) {
  console.log('--strict：存在疑似漏网，退出码 1（登记/人工核对后重跑）')
  process.exit(1)
}
if (!healthy && !args.includes('--strict')) {
  console.log('（默认只提示不阻断：--strict 可让门禁/CI 对疑似漏网报 exit 1）')
}
process.exit(0)
