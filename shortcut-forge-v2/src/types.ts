export const actionKinds = [
  'text',
  'url',
  'openUrl',
  'location',
  'mapsLink',
  'date',
  'clipboard',
  'showResult',
  'email',
] as const

export type ActionKind = (typeof actionKinds)[number]

export type ShortcutAction = {
  id: string
  kind: ActionKind
  title: string
  value?: string
  recipient?: string
  subject?: string
  body?: string
}

export type Workflow = {
  name: string
  actions: ShortcutAction[]
}