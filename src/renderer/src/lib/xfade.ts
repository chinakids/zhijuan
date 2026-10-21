/**
 * 横向可滚动渐隐提示（2026-10-19 体验层，HIG Scroll views「Make it apparent when content is scrollable... it can
 * be helpful to make it obvious when content extends beyond the view」）。
 *
 * 代码块/宽表在 `.prose` 语境出横向滚动（走 overflow-x:auto，2026-10-05/06 体验层宽表防护已做）时，macOS overlay
 * 滚动条无可视提示——作者看到内容被「截断」又不知可横滚，属信息可达性缺口。本模块对每个横向滚动容器按需写入
 * `data-xfade` 属性：仅当「确可横向滚动 且 未滚到最右端（右侧还有内容）」时写入；CSS 据此在最右 28px 做渐隐
 * （tokens.css 的 `.prose pre[data-xfade]/.prose table[data-xfade]`），提示可横向滚动；滚到右端即移除、无滚动
 * 不加，均零影响。零依赖、纯 DOM 装饰，不参与 React 渲染。
 *
 * 资源管理（2026-10-21 收尾走查观察项②）：每个被装饰元素绑定一个 ResizeObserver + scroll 监听，若不随元素
 * 从 DOM 移除而断开，ResizeObserver 会一直持有已移除元素的强引用，长写作会话累积造成内存滞留。故用
 * `adornments` 记录清理句柄，MutationObserver 的 removedNodes 递归断开（React 卸载消息卡/树时的移除路径），
 * `initXFade` 返回的清理则断开全部观察与监听。
 */
const MATCH = 'pre, table'

/** 被装饰元素的清理句柄（ResizeObserver + scroll 监听）。 */
const adornments = new Map<HTMLElement, { ro: ResizeObserver | null; scroll: () => void }>()

function update(el: HTMLElement) {
  const cs = getComputedStyle(el)
  const canScroll = cs.overflowX === 'auto' || cs.overflowX === 'scroll'
  const scrollable = canScroll && el.scrollWidth > el.clientWidth
  // 滚到最右端（右缘 <6px）或右缘只剩非内容区时，不再有「更多内容」信号，撤掉渐隐（避免假提示）。
  const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 6
  if (scrollable && !atEnd) el.setAttribute('data-xfade', '')
  else el.removeAttribute('data-xfade')
}

function cleanup(el: HTMLElement) {
  const a = adornments.get(el)
  if (!a) return
  adornments.delete(el)
  try {
    a.ro?.disconnect()
  } catch {
    /* 已断开 */
  }
  el.removeEventListener('scroll', a.scroll)
}

function adorn(el: HTMLElement) {
  if (adornments.has(el)) return
  update(el)
  let ro: ResizeObserver | null = null
  try {
    ro = new ResizeObserver(() => update(el))
    ro.observe(el)
  } catch {
    /* 极老环境无 ResizeObserver 时退化为仅滚动检测 */
  }
  const scroll = () => update(el)
  el.addEventListener('scroll', scroll, { passive: true })
  adornments.set(el, { ro, scroll })
}

function scan(container: ParentNode = document) {
  container.querySelectorAll(MATCH).forEach((n) => adorn(n as HTMLElement))
}

/** 对移除的子树递归清理其中被装饰的 pre/table（React 卸载消息卡/树时整棵移除的路径）。 */
function cleanupSubtree(root: Element) {
  if (root.matches(MATCH)) cleanup(root as HTMLElement)
  root.querySelectorAll(MATCH).forEach((n) => cleanup(n as HTMLElement))
}

/** 在 App 挂载时初始化：扫描既有 + 以 MutationObserver 跟随 React 渲染新写入的 pre/table，并在移除时断开绑定。
 * 返回清理函数（断开全部观察/监听）。 */
export function initXFade(): () => void {
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      // 先清理移除节点（若同批被移回，则随后靠 addedNodes 重新装饰）。
      for (const n of m.removedNodes) {
        if (n instanceof Element) cleanupSubtree(n)
      }
      for (const n of m.addedNodes) {
        if (n instanceof Element) {
          if (n.matches(MATCH)) adorn(n as HTMLElement)
          const els = n.querySelectorAll(MATCH)
          for (let i = 0; i < els.length; i++) adorn(els[i] as HTMLElement)
        }
      }
    }
  })
  mo.observe(document.body, { subtree: true, childList: true })
  scan(document.body)
  return () => {
    mo.disconnect()
    for (const el of [...adornments.keys()]) cleanup(el)
    adornments.clear()
  }
}
