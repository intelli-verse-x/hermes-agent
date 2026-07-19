import { useStore } from '@nanostores/react'
import type * as React from 'react'
import { useState } from 'react'

import { useRouteEnumParam } from '../hooks/use-route-enum-param'
import { PageSearchShell } from '../page-search-shell'

import { BillingTab } from './billing-tab'
import { ClientsTab } from './clients-tab'
import { ConnectTab } from './connect-tab'
import { CopilotTab } from './copilot-tab'
import { EngagementsTab } from './engagements-tab'
import { SkillsTab } from './skills-tab'
import { IxStatusStrip } from './status-strip'
import { $agencyBook } from './store'
import { ToolsTab } from './tools-tab'

// IX Agency workspace — fully native, no webview: the native copilot
// (LiteLLM + full admin-mcp tool estate, gated behind the native OTP
// sign-in), the CRM trio (clients / engagements / billing, local-first),
// the org's copilot skill + MCP tool catalogs, and Connect (company
// WireGuard VPN, admin-mcp gateway, LiteLLM, Cognito S2S + Hermes init).
const IX_MODES = ['copilot', 'clients', 'engagements', 'billing', 'skills', 'tools', 'connect'] as const

type IxMode = (typeof IX_MODES)[number]

const TAB_LABEL: Record<IxMode, string> = {
  billing: 'Billing',
  clients: 'Clients',
  connect: 'Connect',
  copilot: 'Copilot',
  engagements: 'Engagements',
  skills: 'Org skills',
  tools: 'Org tools'
}

const SEARCH_PLACEHOLDER: Record<IxMode, string> = {
  billing: 'Search invoices…',
  clients: 'Search clients…',
  connect: '',
  copilot: '',
  engagements: 'Search engagements…',
  skills: 'Search org skills…',
  tools: 'Search org tools…'
}

const SEARCHLESS_MODES: ReadonlySet<IxMode> = new Set<IxMode>(['connect', 'copilot'])

export function IxAgencyView(props: React.ComponentProps<'section'>) {
  const [mode, setMode] = useRouteEnumParam('tab', IX_MODES, 'copilot')
  const [query, setQuery] = useState('')
  const book = useStore($agencyBook)

  const counts: Partial<Record<IxMode, number>> = {
    billing: book.invoices.length,
    clients: book.clients.length,
    engagements: book.engagements.length
  }

  return (
    <PageSearchShell
      {...props}
      activeTab={mode}
      filters={<IxStatusStrip />}
      onSearchChange={setQuery}
      onTabChange={id => {
        setMode(id as IxMode)
        setQuery('')
      }}
      searchHidden={SEARCHLESS_MODES.has(mode)}
      searchPlaceholder={SEARCH_PLACEHOLDER[mode]}
      searchValue={query}
      tabs={IX_MODES.map(id => ({
        id,
        label: TAB_LABEL[id],
        meta: counts[id] || undefined
      }))}
    >
      <aside
        aria-label="Intelliverse native engine availability"
        className="mb-3 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground"
      >
        <p className="font-medium text-foreground">Three native engines, one shared Memory</p>
        <p className="mt-1">
          Map each client workspace to one Brand or App ID so Knowledge, customer Memory, credentials, and spend stay
          isolated. Subject identity and consent determine what may continue across approved channels.
        </p>
        <p className="mt-2">
          Connected operating sequence: approved content → Quest quest → participant movement → Kiosk kiosk → product
          handoff → consent-scoped Memory. Each stage still requires its applicable mapping, entitlement, connected
          service, and operator approval; this summary does not claim that a stage has executed.
        </p>
        <ul className="mt-2 grid gap-1 sm:grid-cols-3">
          <li>
            <strong className="text-foreground">Quest:</strong> connected per-App setup; kiosk completion approved
            pilots.
          </li>
          <li>
            <strong className="text-foreground">Content + Postiz:</strong> publishing from a configured Content
            workspace to selected connected Postiz channels; Memory automation rolling out.
          </li>
          <li>
            <strong className="text-foreground">Kiosk:</strong> connected deployment; kiosk Worlds approved pilots.
          </li>
        </ul>
        <p className="mt-2">
          Discount-code and payout review workflows are roadmap, not live Desktop actions. Sign-in requires an
          admin-authorized work email provisioned through the Intelliverse portal. Current authorization is enforced by
          portal entitlements and server-side capability checks; a unified named-role administration panel remains
          roadmap. OS-admin prompts only authorize local installation or VPN changes—they do not grant Intelliverse
          permissions.
        </p>
        <p className="mt-2">
          Clients, engagements, and invoice drafts are local to this device, are not synced platform records, and do not
          send invoices or process payments. Back up or export is not available in this early-access workspace; clearing
          app data removes these records.
        </p>
        <p className="mt-2">
          First run is a guided sequence: email OTP, portal entitlement, assigned credentials, VPN backend and profile,
          VPN verification, LiteLLM verification, then local agent initialization. Open Connect to see each current
          state, retry a failed step, or use an administrator-supplied override.
        </p>
        <a
          className="mt-2 inline-flex font-medium text-foreground underline underline-offset-4"
          href="https://router.intelli-verse-x.ai/apps?intent=connected-engine-setup&role=agency-operator&engine=all&utm_source=ivx-agency-desktop&utm_medium=referral&utm_campaign=native_engines&utm_content=connected_setup"
          rel="noreferrer"
          target="_blank"
        >
          Review the connected-engine setup and pilot path
        </a>
        <span aria-hidden="true" className="mx-2 text-muted-foreground">
          ·
        </span>
        <a
          className="mt-2 inline-flex font-medium text-foreground underline underline-offset-4"
          href="https://router.intelli-verse-x.ai/demo?intent=agency-connected-engine-pilot&role=agency-operator&engine=all&utm_source=ivx-agency-desktop&utm_medium=referral&utm_campaign=native_engines&utm_content=pilot_request"
          rel="noreferrer"
          target="_blank"
        >
          Request an agency connected-engine pilot
        </a>
      </aside>
      {mode === 'copilot' && <CopilotTab />}
      {mode === 'clients' && <ClientsTab query={query} />}
      {mode === 'engagements' && <EngagementsTab query={query} />}
      {mode === 'billing' && <BillingTab query={query} />}
      {mode === 'skills' && <SkillsTab onRunNatively={() => setMode('copilot')} query={query} />}
      {mode === 'tools' && <ToolsTab query={query} />}
      {mode === 'connect' && <ConnectTab />}
    </PageSearchShell>
  )
}
