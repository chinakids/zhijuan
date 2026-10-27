// ===== 新建档案同名查重（纯逻辑；真机 store.uniqueDocName 与 devShim 共用） =====
// 语义：新建人物/世界观/素材卡时，目录内已有同名 → 不覆盖，自动改名「名字 2」「名字 3」……
// 「占用」判定由调用方注入（真机=目标文件存在；devShim=内存 docs key 命中），保持本模块无 fs。

/**
 * 取第一个未被占用的名字：base 空闲则原样返回，否则依次试 `base 2`、`base 3`……
 * 兜底（极端情况 999 个同名）：追加时间戳后缀，保证调用方拿到可用名字。
 */
export function nextFreeName(base: string, isTaken: (name: string) => boolean): string {
  if (!isTaken(base)) return base
  for (let i = 2; i < 1000; i++) {
    const cand = `${base} ${i}`
    if (!isTaken(cand)) return cand
  }
  return `${base} ${Date.now().toString(36)}`
}