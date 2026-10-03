import { z } from 'zod'
import type { ShortcutAction, Workflow } from '../types'

const actionSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string(), kind: z.literal('text'), title: z.string(), value: z.string().min(1) }),
  z.object({ id: z.string(), kind: z.literal('url'), title: z.string(), value: z.string().url() }),
  z.object({ id: z.string(), kind: z.literal('openUrl'), title: z.string() }),
  z.object({ id: z.string(), kind: z.literal('location'), title: z.string() }),
  z.object({ id: z.string(), kind: z.literal('mapsLink'), title: z.string() }),
  z.object({ id: z.string(), kind: z.literal('date'), title: z.string() }),
  z.object({ id: z.string(), kind: z.literal('clipboard'), title: z.string() }),
  z.object({ id: z.string(), kind: z.literal('showResult'), title: z.string() }),
  z.object({ id: z.string(), kind: z.literal('email'), title: z.string(), recipient: z.string().email().optional().or(z.literal('')), subject: z.string().optional(), body: z.string().optional() }),
])

const workflowSchema = z.object({
  name: z.string().trim().min(1, 'اسم الاختصار مطلوب').max(80),
  actions: z.array(actionSchema).min(1, 'أضف خطوة واحدة على الأقل'),
})

export function validateWorkflow(workflow: Workflow) {
  return workflowSchema.safeParse(workflow)
}

const escapeXml = (input = '') => input.replace(/[<>&'\"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char] ?? char))

function params(entries: Record<string, string | boolean>) {
  return Object.entries(entries).map(([key, value]) => `<key>${escapeXml(key)}</key>${typeof value === 'boolean' ? `<${value}/>` : `<string>${escapeXml(value)}</string>`}`).join('')
}

function xmlAction(action: ShortcutAction) {
  const idMap: Record<ShortcutAction['kind'], string> = {
    text: 'is.workflow.actions.gettext', url: 'is.workflow.actions.url', openUrl: 'is.workflow.actions.openurl', location: 'is.workflow.actions.getcurrentlocation', mapsLink: 'is.workflow.actions.getmapslink', date: 'is.workflow.actions.date', clipboard: 'is.workflow.actions.setclipboard', showResult: 'is.workflow.actions.showresult', email: 'is.workflow.actions.sendemail',
  }
  const p: Record<string, string | boolean> = {}
  if (action.kind === 'text') p.WFTextActionText = action.value ?? ''
  if (action.kind === 'url') p.WFURLActionURL = action.value ?? ''
  if (action.kind === 'email') {
    if (action.recipient) p.WFSendEmailActionRecipients = action.recipient
    if (action.subject) p.WFSendEmailActionSubject = action.subject
    if (action.body) p.WFSendEmailActionBody = action.body
    p.WFSendEmailActionShowComposeSheet = true
  }
  return `<dict><key>WFWorkflowActionIdentifier</key><string>${idMap[action.kind]}</string><key>WFWorkflowActionParameters</key><dict>${params(p)}</dict></dict>`
}

export function generateShortcutPlist(workflow: Workflow) {
  const valid = validateWorkflow(workflow)
  if (!valid.success) throw new Error(valid.error.issues[0]?.message ?? 'بيانات غير صالحة')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>WFWorkflowClientVersion</key><string>2600</string><key>WFWorkflowMinimumClientVersion</key><integer>900</integer><key>WFWorkflowIcon</key><dict><key>WFWorkflowIconGlyphNumber</key><integer>59511</integer><key>WFWorkflowIconStartColor</key><integer>4282601983</integer></dict><key>WFWorkflowImportQuestions</key><array/><key>WFWorkflowTypes</key><array/><key>WFWorkflowActions</key><array>${workflow.actions.map(xmlAction).join('')}</array></dict></plist>`
}

export function downloadText(filename: string, content: string, type = 'application/octet-stream') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function parsePrompt(input: string): ShortcutAction[] {
  const text = input.trim()
  if (!text) return []
  const actions: ShortcutAction[] = []
  const url = text.match(/https?:\/\/[^\s،]+/i)?.[0]
  if (url) {
    actions.push({ id: crypto.randomUUID(), kind: 'url', title: 'رابط', value: url })
    if (/افتح|فتح/.test(text)) actions.push({ id: crypto.randomUUID(), kind: 'openUrl', title: 'فتح الرابط' })
  }
  if (/الموقع|موقعي|موقع الحالي/.test(text)) actions.push({ id: crypto.randomUUID(), kind: 'location', title: 'الموقع الحالي' })
  if (/الخريطة|خرائط|maps/i.test(text)) actions.push({ id: crypto.randomUUID(), kind: 'mapsLink', title: 'رابط الخرائط' })
  if (/التاريخ|الوقت|الساعة/.test(text)) actions.push({ id: crypto.randomUUID(), kind: 'date', title: 'التاريخ والوقت' })
  if (/انسخ|الحافظة/.test(text)) actions.push({ id: crypto.randomUUID(), kind: 'clipboard', title: 'نسخ للحافظة' })
  if (/اعرض|أظهر|اظهر/.test(text)) actions.push({ id: crypto.randomUUID(), kind: 'showResult', title: 'عرض النتيجة' })
  return actions
}