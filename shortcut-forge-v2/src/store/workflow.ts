import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ShortcutAction, Workflow } from '../types'

const labels = { text: 'نص', url: 'رابط', openUrl: 'فتح الرابط', location: 'الموقع الحالي', mapsLink: 'رابط خرائط', date: 'التاريخ والوقت', clipboard: 'نسخ للحافظة', showResult: 'عرض النتيجة', email: 'إرسال بريد' } as const

type Store = Workflow & {
  setName: (name: string) => void
  add: (kind: ShortcutAction['kind']) => void
  addMany: (actions: ShortcutAction[]) => void
  update: (id: string, patch: Partial<ShortcutAction>) => void
  remove: (id: string) => void
  move: (from: number, to: number) => void
  clear: () => void
  importWorkflow: (workflow: Workflow) => void
}

export const useWorkflow = create<Store>()(persist((set) => ({
  name: 'اختصاري الجديد',
  actions: [],
  setName: (name) => set({ name }),
  add: (kind) => set(state => ({ actions: [...state.actions, { id: crypto.randomUUID(), kind, title: labels[kind], ...(kind === 'text' ? { value: 'نص جديد' } : {}), ...(kind === 'url' ? { value: 'https://example.com' } : {}) }] })),
  addMany: (actions) => set(state => ({ actions: [...state.actions, ...actions] })),
  update: (id, patch) => set(state => ({ actions: state.actions.map(action => action.id === id ? { ...action, ...patch } as ShortcutAction : action) })),
  remove: (id) => set(state => ({ actions: state.actions.filter(action => action.id !== id) })),
  move: (from, to) => set(state => {
    const actions = [...state.actions]
    const [item] = actions.splice(from, 1)
    if (item) actions.splice(to, 0, item)
    return { actions }
  }),
  clear: () => set({ actions: [] }),
  importWorkflow: (workflow) => set({ name: workflow.name, actions: workflow.actions }),
}), { name: 'shortcut-forge-workflow-v2' }))