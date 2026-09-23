// 织卷探针环境设置 · 共享辅助（2026-09-24 智能层轮）
// ---------------------------------------------------------------------------
// 背景（发布脱敏地雷，2026-09-24 03:00 轮实踩）：
//   src/shared/providers.ts 默认 baseURL=127.0.0.1:8888（2026-09-20 起，发布脱敏占位），
//   本机真实 vLLM（算力池）→ 所有探针在 tmp userdata 下只写 libraryRoot/workspace、
//   不带 llm 时，凡经引擎/模型链路都会连 providers 默认空地址 → 0 字符空轮（假绿/假红均可能）。
//   真机 AppSettings（~/Library/Application Support/zhijuan/zhijuan-settings.json）已写入真实
//   baseUrl（备份 .bak-20260923-prepublish），运行不受影响——探针必须从真机 settings 合并 llm。
// 用法：探针内
//   import { writeProbeSettings } from './lib/probe-settings.mjs'
//   writeProbeSettings({ libraryRoot, workspace, 其他自定义字段... })   // 写 process.env.ZJ_USERDATA
//   writeProbeSettings({ ... }, UD)                                     // 写指定目录
// 语义：extra 字段原样保留；llm 从真机 settings 合并覆盖（extra 里显式传 llm 亦可，不会被覆盖——
//   当前无探针这样做，但写成 extra 优先更符合调用方直觉）。
// 注意：本模块假定调用方已 mkdirSync target（writeProbeSettings 内部再做一次幂等 mkdir 兜底）。
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export const REAL_SETTINGS_PATH = join(
  process.env.HOME ?? '',
  'Library/Application Support/zhijuan/zhijuan-settings.json'
)

/** 读真机 settings 的 llm 段；读不到返回 undefined（不抛异常，避免探针直接崩） */
export function realLlm() {
  try {
    const real = JSON.parse(readFileSync(REAL_SETTINGS_PATH, 'utf-8'))
    if (real?.llm) return real.llm
  } catch {
    /* 静默：调用方决定是否 WARN */
  }
  return undefined
}

/**
 * 合并写盘探针 settings。
 * @param extra 探针自定义字段（libraryRoot/workspace/其他 AppSettings 字段）
 * @param target 写盘目录，缺省 process.env.ZJ_USERDATA（未设置则抛错防静默错位）
 */
export function writeProbeSettings(extra = {}, target = process.env.ZJ_USERDATA) {
  if (!target) throw new Error('writeProbeSettings：target（ZJ_USERDATA）未设置')
  const merged = { ...extra, ...(extra.llm ? {} : { llm: realLlm() }) }
  if (!merged.llm) {
    console.log(
      `WARN：真机 settings（${REAL_SETTINGS_PATH}）无 llm 或读取失败——` +
        '探针若经模型链路将走 providers 默认（127.0.0.1，可能空轮）'
    )
  }
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'zhijuan-settings.json'), JSON.stringify(merged), 'utf-8')
  return merged
}

/** 仅返回合并对象不写盘（用于调用方自行 writeFileSync 的旧形态迁出） */
export function mergedProbeSettings(extra = {}) {
  return { ...extra, ...(extra.llm ? {} : { llm: realLlm() }) }
}

/**
 * 真机 llm 的 chat completions 端点（providers.<active>.baseUrl 派生）。
 * 发布脱敏后仓库内不得出现内网 IP —— 直连探针一律经此取地址；
 * 读不到真机配置时回退 127.0.0.1:8888 占位（此时需人工设置转发或手改）。
 */
export function chatEndpoint() {
  const llm = realLlm()
  const active = llm?.active
  const base = llm?.providers?.[active]?.baseUrl
  if (base) {
    const clean = base.endsWith('/') ? base.slice(0, -1) : base
    return clean.endsWith('/v1') ? `${clean}/chat/completions` : `${clean}/v1/chat/completions`
  }
  return 'http://127.0.0.1:8888/v1/chat/completions'
}

/** 重置探针 userData：清空 → 建目录 → 写入合并真机 llm 的 settings；返回目录路径 */
export function resetProbeUserdata() {
  const dir = process.env.ZJ_USERDATA || '/tmp/zj-smoke-userdata'
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeProbeSettings({})
  return dir
}
