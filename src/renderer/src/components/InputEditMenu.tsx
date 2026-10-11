import { useEffect, useRef, useState } from 'react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './ui/context-menu'

/**
 * 输入面文本编辑右键菜单（HIG Context menus「Support context menus consistently throughout your app」）。
 *
 * 基线（Electron 官方教程实锤）：Electron 默认**无任何**右键菜单——编辑器（Prose）已有自定义菜单、
 * 输入面（Agent 输入框/查找条/设置表单/对话框/批注等 input・textarea）为零 = 全 app 不一致。
 * 本组件：document 捕获阶段监听 contextmenu，目标是 input/textarea 且不在 Prose 内 →
 * 显示标准编辑菜单（剪切/复制/粘贴/全选）。
 *
 * 实现要点：
 * - Radix ContextMenu 定位依据「触发它的 contextmenu 事件坐标」（virtualRef）。输入面无固定触发器，
 *   用一个 0 尺寸隐藏 Trigger：我们在 document 捕获阶段拿到右键事件后，向它派发合成 contextmenu
 *   （bubbles→React 事件委托→Radix handleOpen 记录坐标并打开）。菜单开合由 Radix 自身管理（非受控），
 *   本组件只保存选区/剪贴板快照用于菜单项可用性与动作；
 * - HIG「Hide unavailable menu items」+ macOS 例外「Cut, Copy, and Paste may appear unavailable」：
 *   四项常显、按可用性置灰（TextEdit 惯例），不隐藏；
 * - HIG「Show keyboard shortcuts in your app's main menus, not in context menus」：不显示快捷键；
 * - 动作走浏览器原生命令：cut/copy=execCommand，粘贴=navigator.clipboard.readText +
 *   execCommand('insertText')（execCommand('paste') 在 Chromium 已不可用，本轮探针实测）；
 *   insertText/cut 会触发 input 事件 → React 受控组件 onChange 同步（探针实测）；
 * - Electron 默认自动批准所有权限（官方文档/issue #12931 引用）→ readText 真机可用；
 *   剪贴板读取失败按「可用」保守处理（不因权限问题劣化）；读到空串=明确空→粘贴置灰。
 */
type EditTarget = HTMLInputElement | HTMLTextAreaElement

interface MenuState {
  target: EditTarget | null
  selStart: number
  selEnd: number
  /** 剪贴板读取结果：null=未知/未完成（粘贴可用）；{ok:false}=读取失败（可用）；ok=true 且 text=''=明确空（禁用） */
  clip: { ok: boolean; text: string } | null
}

const INITIAL: MenuState = { target: null, selStart: 0, selEnd: 0, clip: null }

async function readClipboard(): Promise<{ ok: boolean; text: string }> {
  try {
    const text = await navigator.clipboard.readText()
    return { ok: true, text: typeof text === 'string' ? text : '' }
  } catch {
    return { ok: false, text: '' }
  }
}

export default function InputEditMenu() {
  const [st, setSt] = useState<MenuState>(INITIAL)
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const clipSeq = useRef(0)

  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      // 我们派发给隐藏 Trigger 的合成 contextmenu 会再次进入本 handler（capture）——
      // 目标=trigger span，直接放行（不得重置真实右键已存的快照）
      if (triggerRef.current && (e.target === triggerRef.current || triggerRef.current.contains(e.target as Node))) {
        return
      }
      const el = e.target as HTMLElement | null
      const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      // 右键了非文本域：重置快照（Radix 菜单自身会因点外交互/新菜单关闭）
      if (!isField) {
        setSt(INITIAL)
        return
      }
      // Prose 编辑器（Milkdown contenteditable）有自己的右键菜单，放行不接管
      if (el.closest('.ProseMirror')) {
        setSt(INITIAL)
        return
      }
      e.preventDefault()
      setSt({ target: el, selStart: el.selectionStart ?? 0, selEnd: el.selectionEnd ?? 0, clip: null })
      // 交给 Radix ContextMenu 记录右键坐标并打开（合成事件冒泡到 React 事件委托）
      triggerRef.current?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: 2 })
      )
      // 异步读剪贴板判空（HIG macOS 惯例：剪贴板空 → 粘贴置灰）；结果乱序用序号守卫
      const seq = ++clipSeq.current
      void readClipboard().then((r) => {
        if (clipSeq.current !== seq) return
        setSt((prev) => ({ ...prev, clip: r }))
      })
    }
    document.addEventListener('contextmenu', onCtx, true)
    return () => document.removeEventListener('contextmenu', onCtx, true)
  }, [])

  const run = async (kind: 'cut' | 'copy' | 'paste' | 'selectall') => {
    const t = st.target
    if (!t || !t.isConnected) return
    // 菜单获得焦点会影响选区，动作前恢复快照选区到目标输入框（HIG 编辑命令作用于所选内容）
    const restore = () => {
      t.focus()
      try {
        t.setSelectionRange(st.selStart, st.selEnd)
      } catch {
        /* input/textarea 均支持 */
      }
    }
    restore()
    if (kind === 'cut') {
      document.execCommand('cut')
    } else if (kind === 'copy') {
      document.execCommand('copy')
    } else if (kind === 'paste') {
      const r = await readClipboard()
      if (r.ok && r.text) {
        restore()
        document.execCommand('insertText', false, r.text)
      }
    } else {
      t.select()
    }
  }

  const hasSel = st.selEnd > st.selStart
  const valueLen = st.target ? st.target.value.length : 0
  const pasteDisabled = st.clip?.ok === true && st.clip.text === ''

  return (
    <ContextMenu>
      {/* 隐藏触发器：仅供 Radix ContextMenu 记录右键坐标（virtualRef 定位） */}
      <ContextMenuTrigger asChild>
        <span ref={triggerRef} aria-hidden className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0" />
      </ContextMenuTrigger>
      <ContextMenuContent
        className="min-w-[7rem]"
        data-testid="input-edit-menu"
        // 菜单关闭（Esc/点外/选择后）焦点回目标输入框，不落到 0 尺寸隐藏 Trigger（HIG Focus & Selection）
        onCloseAutoFocus={(e) => {
          if (st.target?.isConnected) {
            e.preventDefault()
            st.target.focus()
          }
        }}
      >
        <ContextMenuItem disabled={!hasSel} onSelect={() => void run('cut')}>
          剪切
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasSel} onSelect={() => void run('copy')}>
          复制
        </ContextMenuItem>
        <ContextMenuItem disabled={pasteDisabled} onSelect={() => void run('paste')}>
          粘贴
        </ContextMenuItem>
        <ContextMenuItem disabled={valueLen === 0} onSelect={() => void run('selectall')}>
          全选
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
