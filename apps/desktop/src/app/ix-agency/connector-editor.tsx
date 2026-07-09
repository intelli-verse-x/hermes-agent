import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { IxConnectorDraftInput } from '@/global'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'

import { Field, FieldRow } from './bits'

/**
 * "Add a connector" — desktop twin of the web portal's AddConnectorPanel
 * (super-admin only, enforced server-side). The form never keeps the token
 * beyond the save/test submission: it travels over IPC to the main process,
 * which POSTs it to the portal where it is stored server-side.
 */

// Mirror of the webfrontend's app registry / capability bundles (the portal
// validates against its own list; these just drive the pickers).
export const CONNECTOR_APPS: readonly { id: string; label: string }[] = [
  { id: 'quizverse', label: 'QuizVerse' },
  { id: 'questx', label: 'QuestX' },
  { id: 'intelliverse', label: 'IntelliVerse X' },
  { id: 'toba', label: 'ToBa Tech' },
  { id: 'contentx', label: 'ContentX Studio' },
  { id: 'foundrly', label: 'Foundrly' },
  { id: 'kioskx', label: 'Kiosk X' }
]

export const CONNECTOR_BUNDLES: readonly { id: string; label: string }[] = [
  { id: 'revenue', label: 'Revenue & Payments' },
  { id: 'growth', label: 'Growth & Marketing' },
  { id: 'support', label: 'Support & Customer Ops' },
  { id: 'content', label: 'Content & Product Ops' },
  { id: 'analytics', label: 'Analytics & Insights' },
  { id: 'engineering', label: 'Engineering & Infra' }
]

export interface ConnectorFormState {
  appIds: string[]
  authHeader: string
  bundles: string[]
  category: string
  enabled: boolean
  /** Set when editing an existing connector. */
  id: null | string
  label: string
  readOnlyTools: string
  token: string
  transport: 'cluster-mcp' | 'remote-mcp'
  url: string
}

export const EMPTY_CONNECTOR_FORM: ConnectorFormState = {
  appIds: [],
  authHeader: 'Authorization',
  bundles: [],
  category: 'analytics',
  enabled: true,
  id: null,
  label: '',
  readOnlyTools: '',
  token: '',
  transport: 'remote-mcp',
  url: ''
}

export function formFromDraft(draft: IxConnectorDraftInput): ConnectorFormState {
  return {
    appIds: draft.appIds,
    authHeader: draft.authHeader || 'Authorization',
    bundles: draft.bundles,
    category: draft.category || 'analytics',
    enabled: draft.enabled !== false,
    id: draft.id ?? null,
    label: draft.label,
    readOnlyTools: draft.readOnlyTools.join(', '),
    token: draft.token ?? '',
    transport: draft.transport,
    url: draft.url
  }
}

export function draftFromForm(form: ConnectorFormState): IxConnectorDraftInput {
  return {
    ...(form.id ? { id: form.id } : {}),
    appIds: form.appIds,
    authHeader: form.authHeader.trim() || 'Authorization',
    bundles: form.bundles,
    category: form.category,
    enabled: form.enabled,
    label: form.label.trim(),
    readOnlyTools: form.readOnlyTools
      .split(',')
      .map(prefix => prefix.trim())
      .filter(Boolean),
    ...(form.token.trim() ? { token: form.token.trim() } : {}),
    transport: form.transport,
    url: form.url.trim()
  }
}

/** Toggle-pill multi-select (app / bundle scoping). */
function PillPicker({
  onToggle,
  options,
  selected
}: {
  onToggle: (id: string) => void
  options: readonly { id: string; label: string }[]
  selected: string[]
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(option => {
        const active = selected.includes(option.id)

        return (
          <button
            className={cn(
              'rounded-full px-2 py-0.5 text-[0.68rem]',
              active
                ? 'bg-primary font-medium text-primary-foreground'
                : 'bg-(--ui-bg-quinary) text-muted-foreground hover:bg-(--chrome-action-hover)'
            )}
            key={option.id}
            onClick={() => onToggle(option.id)}
            type="button"
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function ConnectorEditor({
  form,
  onChange,
  onSaved
}: {
  form: ConnectorFormState
  onChange: (next: ConnectorFormState) => void
  onSaved: () => void
}) {
  const bridge = window.hermesDesktop?.ixAgency

  const [busy, setBusy] = useState<'idle' | 'save' | 'test'>('idle')
  const [testResult, setTestResult] = useState<null | { message: string; ok: boolean }>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importJson, setImportJson] = useState('')

  const set = <K extends keyof ConnectorFormState>(key: K, value: ConnectorFormState[K]) =>
    onChange({ ...form, [key]: value })

  const toggleIn = (key: 'appIds' | 'bundles', id: string) => {
    const current = form[key]

    set(key, current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }

  const valid = form.label.trim().length > 0 && /^https?:\/\//i.test(form.url.trim())

  const test = async () => {
    if (!bridge?.connectorsTest || busy !== 'idle') {
      return
    }

    setBusy('test')
    setTestResult(null)

    try {
      // Editing a saved connector without retyping the token → probe with the
      // STORED server-side credential; otherwise probe the form values.
      const result = await bridge.connectorsTest(
        form.id && !form.token.trim()
          ? { id: form.id }
          : { authHeader: form.authHeader.trim() || 'Authorization', token: form.token, url: form.url.trim() }
      )

      setTestResult({ message: result.message, ok: result.ok })
    } catch (error) {
      setTestResult({ message: error instanceof Error ? error.message : String(error), ok: false })
    } finally {
      setBusy('idle')
    }
  }

  const save = async () => {
    if (!bridge?.connectorsSave || busy !== 'idle' || !valid) {
      return
    }

    setBusy('save')

    try {
      const saved = await bridge.connectorsSave(draftFromForm(form))

      // Drop the token from renderer state the moment the save lands.
      onChange({ ...form, id: saved.id, token: '' })
      notify({ message: `Connector saved — ${saved.label}`, detail: 'It is live for the whole org now.' })
      onSaved()
    } catch (error) {
      notifyError(error, 'Could not save the connector')
    } finally {
      setBusy('idle')
    }
  }

  const runImport = async () => {
    if (!bridge?.connectorsParseImport || !bridge.connectorsSave || busy !== 'idle') {
      return
    }

    setBusy('save')

    try {
      const parsed = await bridge.connectorsParseImport(importJson)

      if (parsed.errors.length) {
        notifyError(new Error(parsed.errors.join(' ')), 'Import JSON')
      }

      if (parsed.connectors.length === 1) {
        // Single definition: prefill the form for review instead of blind-saving.
        onChange(formFromDraft(parsed.connectors[0]))
        setImportOpen(false)
        setImportJson('')
        notify({ message: 'Connector definition loaded into the form', detail: 'Review it, then hit Save connector.' })

        return
      }

      let saved = 0

      for (const draft of parsed.connectors) {
        try {
          await bridge.connectorsSave(draft)
          saved += 1
        } catch (error) {
          notifyError(error, `Import failed for "${draft.label}"`)
        }
      }

      if (saved > 0) {
        notify({ message: `Imported ${saved} connector${saved === 1 ? '' : 's'}` })
        setImportOpen(false)
        setImportJson('')
        onSaved()
      }
    } finally {
      setBusy('idle')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {form.id ? 'Edit connector' : 'Add a connector'}
        </h3>
        <Button onClick={() => setImportOpen(open => !open)} size="xs" variant={importOpen ? 'secondary' : 'outline'}>
          <Codicon name="json" size="0.75rem" />
          Import JSON
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Point the copilot at any MCP endpoint — the portal stores it for the whole org (super-admin only). The token
        is kept server-side and never shown again.
      </p>

      {importOpen && (
        <div className="space-y-2 rounded-md border border-(--ui-border-primary) p-3">
          <span className="text-[0.68rem] font-medium text-muted-foreground">
            Paste a connector definition (JSON object) or a list of them (JSON array)
          </span>
          <Textarea
            className="min-h-28 font-mono text-[0.7rem]"
            onChange={event => setImportJson(event.target.value)}
            placeholder='[{"label": "My MCP", "url": "https://example.com/mcp", "transport": "remote-mcp"}]'
            value={importJson}
          />
          <Button disabled={busy !== 'idle' || !importJson.trim()} onClick={() => void runImport()} size="sm">
            <Codicon name={busy === 'save' ? 'loading~spin' : 'cloud-download'} size="0.8125rem" />
            Import
          </Button>
        </div>
      )}

      <FieldRow>
        <Field label="Name">
          <Input onChange={event => set('label', event.target.value)} placeholder="Stripe MCP" value={form.label} />
        </Field>
        <Field label="Transport">
          <Select onValueChange={value => set('transport', value as ConnectorFormState['transport'])} value={form.transport}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="remote-mcp">remote-mcp (public HTTPS)</SelectItem>
              <SelectItem value="cluster-mcp">cluster-mcp (in-cluster)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </FieldRow>
      <Field label="MCP endpoint URL">
        <Input
          onChange={event => set('url', event.target.value)}
          placeholder="https://mcp.example.com/mcp"
          value={form.url}
        />
      </Field>
      <FieldRow>
        <Field label="Auth header">
          <Input
            onChange={event => set('authHeader', event.target.value)}
            placeholder="Authorization"
            value={form.authHeader}
          />
        </Field>
        <Field label="Token / API key (stored server-side, never shown again)">
          <Input
            autoComplete="off"
            onChange={event => set('token', event.target.value)}
            placeholder={form.id ? 'Leave blank to keep the stored token' : 'Bearer token or API key'}
            type="password"
            value={form.token}
          />
        </Field>
      </FieldRow>
      <Field label="Category (capability bundle)">
        <Select onValueChange={value => set('category', value)} value={form.category}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONNECTOR_BUNDLES.map(bundle => (
              <SelectItem key={bundle.id} value={bundle.id}>
                {bundle.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="space-y-1">
        <span className="block text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground/60">
          Show in these apps (empty = all)
        </span>
        <PillPicker onToggle={id => toggleIn('appIds', id)} options={CONNECTOR_APPS} selected={form.appIds} />
      </div>
      <div className="space-y-1">
        <span className="block text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground/60">
          Include in bundles (empty = category only)
        </span>
        <PillPicker onToggle={id => toggleIn('bundles', id)} options={CONNECTOR_BUNDLES} selected={form.bundles} />
      </div>
      <Field label="Read-only tool prefixes (comma-separated — matching tools skip the write gate)">
        <Input
          onChange={event => set('readOnlyTools', event.target.value)}
          placeholder="list_, get_, search_"
          value={form.readOnlyTools}
        />
      </Field>

      <div className="flex items-center gap-2">
        <Button
          disabled={busy !== 'idle' || (!form.id && !/^https?:\/\//i.test(form.url.trim()))}
          onClick={() => void test()}
          size="sm"
          variant="outline"
        >
          <Codicon name={busy === 'test' ? 'loading~spin' : 'plug'} size="0.8125rem" />
          Test connection (tools/list)
        </Button>
        <Button disabled={busy !== 'idle' || !valid} onClick={() => void save()} size="sm">
          <Codicon name={busy === 'save' ? 'loading~spin' : 'save'} size="0.8125rem" />
          Save connector
        </Button>
      </div>
      {testResult && (
        <p
          className={cn(
            'rounded-md border px-3 py-2 text-xs',
            testResult.ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
          )}
        >
          {testResult.message}
        </p>
      )}
    </div>
  )
}
