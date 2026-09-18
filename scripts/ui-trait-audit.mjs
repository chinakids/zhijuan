#!/usr/bin/env node
// 织卷冒烟「UI 结构特征断链」审计（平台层 2026-09-18 22:30 轮，观察项 ㊲ 落实）
// ---------------------------------------------------------------------------
// 背景：UI 结构收敛（去卡片化/去徽标/改类名/删状态文本）后，冒烟脚本若仍按「已收敛的 UI 特征」
//       定位/断言会静默断链。2026-09-18 实踩：9048f00（工具调用去卡片化）移除「失败/已恢复」徽标
//       pill 与 rounded-lg/border-hair 卡容器后，toolcard-fail/toolcard-timing/chain-recover 三支
//       冒烟断链（19:30 轮修复）。textclick-audit（㉟）只覆盖「按钮文本点击」——徽标文本/CSS 容器
//       选择器是盲区第二波（19:30 轮观察项 ㊲ 原文）。
// 方法：静态扫描 scripts/ 中结构敏感断言（类名引用 / 短中文文本断言），提取 UI 特征 token，
//       与 src/ 现状做「存在性」比对：src 已无此特征 ⇒ 断言必然落空（真断链，红，exit 1）；
//       src 仍存在 ⇒ 绿（特征还在渲染，断言合法）。判据随 UI 收敛自动翻转——无需手维护词库。
//       与 textclick-audit 互补：那里按钮文本可能仍存在于 aria-label/title 而按钮已 icon-only
//       （src 存在性判不住，须手维护词库）；本审计面向「特征整体消失」类收敛（文本/类名从src消失）。
// 局限（启发式，维持定位级）：动态拼接的类名/文本、注释中的特征词可能漏报或误绿；健康输出附
//       「人工抽查清单」全量列出——UI 收敛提交后仍应先跑本脚本再人工浏览清单。
//       【2026-09-19 07:30 平台层轮补录】「变量中转 includes」不在提取面：const x=…innerText??''; x.includes('旧文案')
//       形态静态无法关联 src（479575e 素材库 clear 改 icon-only 后 library-cat L94 断链即此形态——textclick
//       （只审 button 上下文）与本审计（只审 innerText/textContent 紧跟参数）均抓不到，点名回归才赶上）。
//       该形态断言一律优先 data-testid/data-* 结构化锚点（本次 library-cat 已改）。
// 用法：node scripts/ui-trait-audit.mjs            # 扫描（失配>0 exit 1）
//       node scripts/ui-trait-audit.mjs --selfcheck # 判据自检：探针注入→必红→删除→恢复（变异测试思想）
// 门禁接入（本轮）：smoke-ui.mjs --all 已 import analyze/report 同进程复用为元审计第四段（只提示不阻断，
//   continue-on-error 同模型/userData/文本点击三审计先例；CI 阻断=本脚本直跑 exit 1）。
//   改本脚本判据后：先 node scripts/ui-trait-audit.mjs --selfcheck 再直跑确认健康（㉖/㉘ 同款契约）。
// 维护契约（UI 结构收敛提交后执行）：
//   1. 跑 node scripts/ui-trait-audit.mjs —— 应红出残留断言（引用已消失特征）
//   2. 同步脚本断言：优先 data-testid/data-* 结构化锚点（9048f00 后 toolcard-fail/tool-cancel 口径）
//   3. 复跑归零失配 + 跑受触面冒烟确认
// 约束：本文件名不含 smoke（isSmoke=/smoke/i 不命中），不会进 smoke-ui --all 集合。
import { readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url)) // 与 smoke-ui 同源（fileURLToPath 防中文路径被 URL 编码）
const SRC_DIR = resolve(SCRIPTS_DIR, '../src') // 验证面=src/ 全量（main/preload/shared/renderer 的 ts/tsx/css）
const SELF = [
  'ui-trait-audit.mjs', 'textclick-audit.mjs', 'smoke-ui.mjs', 'smoke-model-audit.mjs',
  'smoke-userdata-check.mjs', 'smoke-gate-check.mjs', 'model-scripts.mjs', 'stats-live-probe.mjs',
]
// 负向豁免（同 textclick-audit 收紧版）：断言「特征已消失」是合法用法（例如断言无失败徽标）——行上下文命中即整行豁免
const NEGATIVE_HINT = /已移除|已删除|应为空|没有.*?(徽标|卡片|按钮|行)|无.*?(徽标|卡片)|移除/

// ---------- 提取纯函数（可单测） ----------
// 类名 token：从「选择器字符串参数」里取【.foo / [class="..."] / [class*="..."]】内容
export function classTokensOf(selStr) {
  const tokens = new Set()
  // .foo 形式（排除标签名：正则要求前面是 " 或 ' 或空格或 ( ——直接用全局 .\w 提取，非类名英文词由 src 存在性兜底）
  let m
  const dotRe = /[.(]([A-Za-z][\w-]{2,})/g
  while ((m = dotRe.exec(selStr)) !== null) {
    if (!looksFileExt(m[1])) tokens.add(m[1])
  }
  // [class*="x y"] / [class~="x"] / [class="x y"]——取引号内容按空格拆
  const attrRe = /class\s*(?:\*|\~|=)?\s*=\s*[`'"]([^`'"]+)[`'"]/g
  while ((m = attrRe.exec(selStr)) !== null) {
    for (const t of m[1].split(/\s+/)) {
      if (t && !looksFileExt(t)) tokens.add(t)
    }
  }
  return [...tokens]
}
const looksFileExt = (t) => /\.(mjs|md|png|json|ts|tsx|css|html|js)$/.test(t)

// className/classList includes 形态：(p.className||'').includes('bg-danger-soft') / cls.includes('hover:border-hair-strong')
export function includesTokensOf(argStr) {
  const t = argStr.trim().replace(/^[`'"]|[`'"]$/g, '')
  if (!/^[A-Za-z][\w:/-]*$/.test(t)) return [] // 非类名形态（中文/空格=别的断言内容）不审
  // 基 token：剥 Tailwind 变体前缀（hover:/active:/group-hover:/focus-visible:）与透明度后缀（/60）
  const base = t.split(':').pop().split('/')[0]
  return base && !looksFileExt(base) ? [base] : []
}

// 短中文文本候选（聚焦状态徽标词；数据形态=数字/字母/×/「第N」/输入值与 demo 数据——豁免）
export function textCandidatesOf(quote) {
  const s = quote
  if (s.includes('${')) return null // 模板拼接，跳过
  if (/[；：。，]/.test(s)) return null // 句子形态非徽标词
  if (/[A-Za-z0-9]/.test(s) || s.includes('×')) return null // 含数字/字母/×=计数·序号·输入值·触发词形态（模板文案「拦截 N 条」同源）
  if (/第[一二三四五六七八九十]/.test(s)) return null // 第N章/幕/版/段 数据形态
  if (DATA_LEXICON.includes(s)) return null // 已知豁免：冒烟输入值/demo 数据（维护=新增输入型断言时同步）
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length
  if (cjk < 2 || cjk > 6) return null
  return s
}
// 已知与 src 字面量无关的短文本（类型=输入值/demo 数据/或分支残留；失配≠结构断链，明示豁免可解释）
const DATA_LEXICON = ['单线回归章', '测试类别', '帮我再改一段', '我的项目', '需要一段描写', '模板冒烟项目']

// ---------- 扫描 ----------
function scan() {
  const rows = []
  const files = readdirSync(SCRIPTS_DIR).filter(
    (f) => (f.endsWith('.mjs') || f.endsWith('.cjs')) && !SELF.includes(f),
  )
  for (const f of files) {
    const src = readFileSync(join(SCRIPTS_DIR, f), 'utf8')
    const lines = src.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const bare = line.trim()
      if (bare.startsWith('//') || bare.startsWith('/*') || bare.startsWith('*') || bare.startsWith('#')) continue
      const ctxAll = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4)).join(' ')
      if (NEGATIVE_HINT.test(ctxAll)) continue // 负向断言豁免（整行上下文）
      const hits = []
      // ① 类名引用：选择器形态
      if (/querySelector(?:All)?\s*\(/.test(line) || /closest\s*\(/.test(line) || /matches\s*\(/.test(line)) {
        const selRe = /(?:querySelector(?:All)?|closest|matches)\s*\(\s*[`'"]([^`'"]+)[`'"]/g
        let m
        while ((m = selRe.exec(line)) !== null) {
          for (const tok of classTokensOf(m[1])) {
            if (tok) hits.push({ kind: 'class', tok })
          }
        }
      }
      // ② 类名引用：className/classList/cls includes 形态（上下文=className/classList/cls 之后 60 字符内的 includes；token 限类名形态）
      if (/(?:className|classList|\.cls)\b/.test(line) && /includes\s*\(/.test(line)) {
        const incRe = /(?:className|classList|\.cls)(?:[^;\n]{0,60}?)\.includes\s*\(\s*[`'"]([^`'"]+)[`'"]\s*\)/g
        let m
        while ((m = incRe.exec(line)) !== null) {
          for (const tok of includesTokensOf(m[1])) {
            if (tok) hits.push({ kind: 'class', tok })
          }
        }
      }
      // ③ 短中文文本断言：文本比较（includes/===）紧跟在 innerText/textContent 后（evalUntil 的步骤名等非比较字符串不提取）
      if (/textContent|innerText/.test(line)) {
        const cmpRe = /(?:innerText|textContent)(?:[^;\n]{0,60}?)(?:\.includes|\.indexOf|\.startsWith|includes|\s===)\s*\(?\s*[`'"]([^`'"\\]{1,14})[`'"]/g
        let m
        while ((m = cmpRe.exec(line)) !== null) {
          const cand = textCandidatesOf(m[1])
          if (cand) hits.push({ kind: 'text', tok: cand })
        }
      }
      for (const h of hits) rows.push({ f, n: i + 1, ...h, line: line.trim().slice(0, 140) })
    }
  }
  // 去重（同文件 同行 同特征）
  const seen = new Set()
  return rows.filter((r) => {
    const k = `${r.f}#${r.n}#${r.kind}#${r.tok}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ---------- src 验证面（构建一次） ----------
function srcIndex() {
  let all = ''
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx|css)$/.test(e.name)) all += readFileSync(p, 'utf8')
    }
  }
  walk(SRC_DIR)
  return all
}

export function analyze() {
  const rows = scan()
  const srcAll = srcIndex()
  const missing = []
  for (const r of rows) {
    if (!srcAll.includes(r.tok) && !EXEMPT_TOKEN.test(r.tok)) missing.push(r)
  }
  // 分层：类名失配=红判据（选择器必然匹配不到=真断链）；文本失配=⚠ 提示级（模板/动态/输入值形态不能静态判死）
  const missingClass = missing.filter((r) => r.kind === 'class')
  const missingText = missing.filter((r) => r.kind === 'text')
  return { rows, missing, missingClass, missingText }
}
// 豁免：第三方运行时类名（lucide-react 图标类在运行时生成，src 无字面量属正常——非 UI 结构特征）
const EXEMPT_TOKEN = /^lucide-/

// 门禁元审计报告（同 textclick-audit 形态）：类名失配=红（exit 1）；文本失配=⚠ 提示（不阻断）
export function report({ rows, missing, missingClass, missingText }) {
  const clsN = rows.filter((r) => r.kind === 'class').length
  const txtN = rows.filter((r) => r.kind === 'text').length
  console.log(`UI 结构特征审计 · 扫描 scripts/ 结构敏感断言：类名引用 ${clsN} 处 · 短文本断言 ${txtN} 处；与 src/ 存在性比对失配 ${missingClass.length + missingText.length}（类名 ${missingClass.length} · 文本 ${missingText.length}）`)
  if (missingClass.length) {
    console.log(`❗ 疑似断链 ${missingClass.length} 处（scripts 引用 src/ 已消失的类名——选择器必落空）：`)
    for (const h of missingClass) console.log(`  ${h.f}:${h.n}  类名「${h.tok}」`)
    console.log('  ↓ 处置：断言改 data-testid/data-* 锚点（9048f00 后 toolcard-fail/tool-cancel 口径）或核对 src 现状')
    if (missingText.length) {
      console.log(`⚠ 另文本失配 ${missingText.length} 处（src/ 无此字面量——模板拼接/输入值/徽标文本消失三解，需人工核）：`)
      for (const h of missingText) console.log(`  ${h.f}:${h.n}  文本「${h.tok}」`)
    }
    return false
  }
  if (missingText.length) {
    console.log(`⚠ 文本失配 ${missingText.length} 处（src/ 无此字面量——模板拼接/输入值/徽标文本消失三解，需人工核）：`)
    for (const h of missingText) console.log(`  ${h.f}:${h.n}  文本「${h.tok}」`)
    console.log('  ↓ 徽标文本确实已从 src 消失=真断链：改 data-* 锚点；模板/输入值=加 DATA_LEXICON 豁免')
  }
  if (!missingClass.length && !missingText.length) console.log('✅ 零失配：无「断言引用已消失 UI 特征」断链')
  return true
}

// ---------- --selfcheck：临时探针 + 断言（变异测试思想，负向实证资产化） ----------
function selfcheck() {
  const probe = join(SCRIPTS_DIR, '_ui-trait-probe-a.mjs')
  try {
    writeFileSync(
      probe,
      "// 临时探针（自检用，跑完即删）：引用 src 未出现的类名与短文本——必判失配\n" +
        "const el = document.querySelector('div.zj-ui-trait-nonexistent-xyz')\n" +
        "const ok = document.body.innerText.includes('徽标断链词')\n" +
        "void el; void ok\n",
    )
    const r = analyze()
    const bad = []
    const hitClass = r.missing.some((h) => h.f === '_ui-trait-probe-a.mjs' && h.kind === 'class' && h.tok === 'zj-ui-trait-nonexistent-xyz')
    const hitText = r.missing.some((h) => h.f === '_ui-trait-probe-a.mjs' && h.kind === 'text' && h.tok === '徽标断链词')
    if (!hitClass) bad.push('引用 src 未出现类名的探针未被判失配（正向失败）')
    if (!hitText) bad.push('引用 src 未出现短文本的探针未被判失配（正向失败）')
    if (report(r)) bad.push('类名失配在场但 report 返回 true（红判据失败）')
    rmSync(probe, { force: true })
    const r2 = analyze()
    if (r2.missing.some((h) => h.f === '__ui-trait-probe-a.mjs')) bad.push('删除探针后仍留失配（负向失败）')
    if (bad.length) {
      console.log(`\n--selfcheck：${bad.length} 项失败 ❌\n  ${bad.join('\n  ')}`)
      return false
    }
    console.log('\n--selfcheck：3 项通过，判据自检通过 ✅（探针已清理）')
    return true
  } finally {
    rmSync(probe, { force: true })
  }
}

// ---------- 主流程（仅 CLI 直跑时执行；被 smoke-ui.mjs import 时只取 analyze/report，与 textclick-audit 同构） ----------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
  if (process.argv.includes('--selfcheck')) {
    process.exit(selfcheck() ? 0 : 1)
  }
  const result = analyze()
  const ok = report(result)
  if (result.rows.length) {
    console.log('\n---- 结构敏感断言清单（人工抽查；动态拼接/注释词可能漏报）----')
    for (const r of result.rows) console.log(`${r.f}:${r.n}  ${r.kind === 'class' ? '类名' : '文本'}「${r.tok}」`)
  }
  console.log('')
  process.exit(ok ? 0 : 1)
}
