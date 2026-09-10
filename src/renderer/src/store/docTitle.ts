import { create } from 'zustand'

/**
 * 当前文档题名（自定义标题栏 V3：HIG「标题用内容不用 App 名」）。
 * 由文档页（Novel 等）在内容变化时写入；离开时置空。仅 UI 态，不落盘。
 */
interface DocTitleStore {
  title: string
  setTitle: (t: string) => void
}

export const useDocTitleStore = create<DocTitleStore>((set) => ({
  title: '',
  setTitle: (t) => set({ title: t })
}))
