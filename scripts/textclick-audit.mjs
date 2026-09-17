#!/usr/bin/env node
// 织卷冒烟「按文本点击」断链审计（平台层 2026-09-17 16:30 轮，观察项 ㉟ 落实）
// ---------------------------------------------------------------------------
// 背景：功能点收敛类 UI 改动（icon-only/菜单化/删除按钮）后，冒烟脚本若仍按按钮文本
//       查找/点击会静默断链（NOT_FOUND→无动作→TOAST TIMEOUT 假失败）。2026-09-17 实踩：
//       f535050（大纲顶栏 7 文字按钮→2 文字+5 icon-only）后 toast-ui 仍按 innerText 点击
//       「导演本章/回建缺失」→ 断链（13:30 轮修复）；3e0ec55（检查菜单化）、f2cc9b3
//       （删除引用选中）、5261a3f（本地规则迁状态栏）同型。本脚本=把「UI 收敛后必须
//       复查脚本文本点击」从人盯变成可复用审计。
// 方法：静态扫描 scripts/ 中「按钮/菜单项查找 + textContent/innerText 文本比较」的
//       表达式（含 clickByText/clickOnText/clickAria 等 helper 调用），提取中文字面量，
//       与 ICON_ONLY_LEXICON（已知已收敛为 icon-only/已删除的按钮文本，手维护）求交集：
//         · 词库命中    → 疑似断链（红，exit 1——修断言或更新词库前必看）
//         · 词库未命中  → 文本仍在按钮上或为非按钮内容断言（绿，人工抽查）
//       注意：本审计是静态启发式——「未命中」不保证安全（如按钮文本由变量拼接），
//       UI 收敛改动后仍应人工浏览输出清单；词库更新时机=UI 收敛提交同步进行。
// 用法：node scripts/textclick-audit.mjs            # 扫描（exit 0/1）
//       node scripts/textclick-audit.mjs --lexicon  # 打印词库（核对维护面）
// 维护：改 UI（按钮 icon-only/删除/菜单化）→ 同步 ICON_ONLY_LEXICON（若有对应文本）并跑本脚本。
// 约束：本文件名不含 smoke（isSmoke=/smoke/i 不命中），不会进 smoke-ui --all 集合。
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ---- 已收敛为 icon-only / 已删除的按钮文本（手维护；来源=源码 aria-label/title/删除记录）----
// 2026-09-17 f535050（大纲顶栏）：回建缺失/导演本章/兑现检查/补写缺段/全部回建
// 2026-09-16 f2cc9b3：引用选中（删除）
// 2026-09-12 3e0ec55：检查类 icon 收进「检查 ▾」菜单（本地核查 7 项后用状态栏）
// 2026-09-14 dc9045c：工具链「展开/收起」为 icon 按钮
export const ICON_ONLY_LEXICON = [
  '回建缺失', '导演本章', '兑现检查', '补写缺段', '全部回建',
  '引用选中', '版本历史',
]

const SCRIPTS_DIR = process.cwd() + '/scripts'
const SELF = ['textclick-audit.mjs', 'scan-textclick.mjs']

// ---------- 扫描：按文本查找「按钮/菜单项」的表达式行 ----------
const cmdRe = /textContent|innerText/
const isBtnSel = (line) => /button|menuitem/.test(line)
const litRe = /['"`]((?:[^'"`\\]|\\.){2,30})['"`]/g

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
      if (!cmdRe.test(line) || !isBtnSel(line)) continue
      // 提取中文字面量（按钮文本候选）
      const lits = []
      let m
      litRe.lastIndex = 0
      while ((m = litRe.exec(line)) !== null) {
        if (/[\u4e00-\u9fff]/.test(m[1])) lits.push(m[1])
      }
      if (!lits.length) continue
      // helper 调用形态（clickByText('...') 等）可能参数在下一行——向前合并 3 行找参数
      let ctx = line
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        if (/button|menuitem/.test(lines[j]) || /clickByText|clickOnText/.test(lines[j])) {
          ctx += ' ' + lines[j]
        }
      }
      rows.push({ f, n: i + 1, lits, line: ctx.trim().slice(0, 170), all: lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4)).join(' ') })
    }
  }
  // 去重（同文件同行）
  const seen = new Set()
  return rows.filter((r) => {
    const k = `${r.f}#${r.n}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

const rows = scan()
const hits = []
// 负向断言豁免：查找按钮文本后断言「已移除/不存在」是合法用法（icon-size「引用选中」先例）
const NEGATIVE_HINT = /已移除|不存在|已删除|已取消|应为空|没有.*按钮|移除/
for (const r of rows) {
  const ctxAll = r.all
  for (const lit of r.lits) {
    if (ICON_ONLY_LEXICON.some((k) => lit.includes(k) || k.includes(lit))) {
      const negative = NEGATIVE_HINT.test(ctxAll)
      if (!negative) hits.push({ ...r, lit })
      break
    }
  }
}

console.log(`扫描 scripts/ 按钮文本查找调用点：${rows.length} 处；词库 ${ICON_ONLY_LEXICON.length} 词`)
if (process.argv.includes('--lexicon')) {
  console.log('词库：')
  for (const k of ICON_ONLY_LEXICON) console.log(`  - ${k}`)
}
console.log('')
if (rows.length) {
  console.log('---- 全部调用点（人工抽查清单）----')
  for (const r of rows) console.log(`${r.f}:${r.n}  「${r.lits.join(' / ')}」`)
}
console.log('')
if (hits.length) {
  console.log(`❗ 疑似断链 ${hits.length} 处（文本查找命中等 icon-only/已删除按钮）：`)
  for (const h of hits) console.log(`  ${h.f}:${h.n}  「${h.lit}」`)
  console.log('  ↓ 处置：改 aria-label/title 查找 或 更新词库后重跑')
  process.exit(1)
}
console.log('✅ 零词库命中：当前无「已收敛按钮仍被文本点击」断链')
process.exit(0)
