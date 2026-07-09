import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Switch } from '@/components/ui/switch'
import type { IxDynamicConnectorRow, IxMcpTileHealth } from '@/global'
import { normalize } from '@/lib/text'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'

import { DetailColumn, ListColumn, ListStrip, MasterDetail } from '../master-detail'
import { PanelEmpty, PanelListRow, PanelMeta, PanelSectionLabel } from '../overlays/panel'

import { CONNECTOR_BUNDLES, ConnectorEditor, type ConnectorFormState, EMPTY_CONNECTOR_FORM, formFromDraft } from './connector-editor'
import mcpTilesData from './data/mcp-tiles.json'
import { $ixDisabledMcpTiles, $ixSync, runIxSync, setMcpTileEnabled } from './sync-store'
import type { IxMcpTileItem } from './types'

// Bundled admin-mcp registry snapshot; the post-login auto-attach sync swaps
// in the live directory + dynamic connectors, and Refresh re-runs it.
const BUNDLED_TILES: IxMcpTileItem[] = Array.isArray(mcpTilesData.items) ? (mcpTilesData.items as IxMcpTileItem[]) : []

const BUNDLED_DETAIL = 'Bundled registry snapshot — sign in (or configure the gateway token in Connect) for live data.'

const LAMP_DOT: Record<IxMcpTileHealth['state'], string> = {
  green: 'bg-emerald-500',
  grey: 'bg-neutral-400',
  red: 'bg-red-500'
}

const LAMP_LABEL: Record<IxMcpTileHealth['state'], string> = {
  green: 'Connected — tools/list answered',
  grey: 'Reachable, auth required',
  red: 'Unreachable'
}

type Selection = { id: string; kind: 'connector' | 'tile' } | { kind: 'add' } | null

function bundleLabel(id: string): string {
  return CONNECTOR_BUNDLES.find(bundle => bundle.id === id)?.label ?? id
}

export function ToolsTab({ query }: { query: string }) {
  const bridge = window.hermesDesktop?.ixAgency
  const sync = useStore($ixSync)
  const disabledIds = useStore($ixDisabledMcpTiles)

  const [selection, setSelection] = useState<Selection>(null)
  const [busy, setBusy] = useState(false)
  const [health, setHealth] = useState<Record<string, IxMcpTileHealth>>({})
  const [connectorForm, setConnectorForm] = useState<ConnectorFormState>(EMPTY_CONNECTOR_FORM)

  const tiles = sync?.tiles.length ? sync.tiles : BUNDLED_TILES
  const connectors = sync?.connectors ?? []
  const detailLine = sync?.tilesDetail || BUNDLED_DETAIL

  const refreshHealth = useCallback(
    async (refresh: boolean) => {
      if (!bridge?.mcpHealth) {
        return
      }

      try {
        const { results } = await bridge.mcpHealth(refresh)

        setHealth(Object.fromEntries(results.map(result => [result.tileId, result])))
      } catch {
        // Lamps just stay unknown until the next probe succeeds.
      }
    },
    [bridge]
  )

  // First paint: cached lamps. New sync (login / refresh) → re-probe so
  // freshly attached connectors get lamps too.
  useEffect(() => {
    void refreshHealth(false)
  }, [refreshHealth, sync?.syncedAt])

  const refresh = useCallback(async () => {
    setBusy(true)

    try {
      await runIxSync()
      await refreshHealth(true)
    } catch (error) {
      notifyError(error, 'Refresh failed')
    } finally {
      setBusy(false)
    }
  }, [refreshHealth])

  const patchConnector = async (connector: IxDynamicConnectorRow, enabled: boolean) => {
    if (!bridge?.connectorsPatch) {
      return
    }

    try {
      await bridge.connectorsPatch({ enabled, id: connector.id })
      await runIxSync()
    } catch (error) {
      notifyError(error, 'Could not update the connector')
    }
  }

  const deleteConnector = async (connector: IxDynamicConnectorRow) => {
    if (!bridge?.connectorsDelete) {
      return
    }

    try {
      await bridge.connectorsDelete(connector.id)
      notify({ message: `Connector deleted — ${connector.label}` })
      setSelection(null)
      await runIxSync()
    } catch (error) {
      notifyError(error, 'Could not delete the connector')
    }
  }

  const exportConnectors = async () => {
    if (!bridge?.connectorsExport) {
      return
    }

    try {
      const result = await bridge.connectorsExport()

      await navigator.clipboard.writeText(result.json)
      notify({
        message: `Copied ${result.count} connector definition${result.count === 1 ? '' : 's'} to the clipboard`,
        detail: 'Tokens are never included in exports.'
      })
    } catch (error) {
      notifyError(error, 'Export failed')
    }
  }

  const q = normalize(query)

  const filteredTiles = tiles.filter(
    tile => !q || normalize(`${tile.id} ${tile.label} ${tile.blurb ?? ''} ${tile.group ?? ''}`).includes(q)
  )

  const filteredConnectors = connectors.filter(
    connector => !q || normalize(`${connector.id} ${connector.label} ${connector.url} ${connector.category}`).includes(q)
  )

  const groups = [...new Set(filteredTiles.map(tile => tile.group || 'Other'))]

  const selectedTile = selection?.kind === 'tile' ? (tiles.find(tile => tile.id === selection.id) ?? null) : null

  const selectedConnector =
    selection?.kind === 'connector' ? (connectors.find(connector => connector.id === selection.id) ?? null) : null

  const lampFor = (id: string) => health[id] ?? null

  const rowFor = (id: string, title: string, kind: 'connector' | 'tile') => {
    const lamp = lampFor(id)
    const disabled = disabledIds.includes(id)
    const active = selection?.kind === kind && selection.id === id

    return (
      <div className={cn('flex items-center gap-1 pr-1', disabled && 'opacity-45')} key={`${kind}:${id}`}>
        <div className="min-w-0 flex-1">
          <PanelListRow
            active={active}
            dotClassName={lamp ? LAMP_DOT[lamp.state] : 'bg-neutral-500/30'}
            onSelect={() => setSelection({ id, kind })}
            title={title}
          />
        </div>
        <Switch
          aria-label={`Enable ${title}`}
          checked={!disabled}
          onCheckedChange={enabled => setMcpTileEnabled(id, enabled)}
          size="xs"
        />
      </div>
    )
  }

  const lampBadge = (lamp: IxMcpTileHealth | null) =>
    lamp ? (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <span aria-hidden className={cn('size-2 rounded-full', LAMP_DOT[lamp.state])} />
        {LAMP_LABEL[lamp.state]}
        {typeof lamp.toolCount === 'number' && ` — ${lamp.toolCount} tools`}
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">Not probed yet</span>
    )

  return (
    <MasterDetail split="wide">
      <ListColumn
        header={
          <ListStrip
            left={<span className="truncate text-[0.65rem] text-muted-foreground/60">{detailLine}</span>}
            right={
              <Button disabled={busy} onClick={() => void refresh()} size="icon-xs" title="Refresh directory + lamps" variant="ghost">
                <Codicon name={busy ? 'loading~spin' : 'refresh'} size="0.8125rem" />
              </Button>
            }
          />
        }
      >
        {groups.map(group => (
          <div key={group}>
            <PanelSectionLabel className="px-2 pb-0.5 pt-2">{group}</PanelSectionLabel>
            {filteredTiles
              .filter(tile => (tile.group || 'Other') === group)
              .map(tile => rowFor(tile.id, tile.label, 'tile'))}
          </div>
        ))}
        <div>
          <PanelSectionLabel className="px-2 pb-0.5 pt-2">Dynamic connectors</PanelSectionLabel>
          {filteredConnectors.map(connector => rowFor(connector.id, connector.label, 'connector'))}
          {sync?.connectorsError && (
            <p className="px-2 py-1 text-[0.65rem] leading-relaxed text-muted-foreground/60">{sync.connectorsError}</p>
          )}
          <PanelListRow
            active={selection?.kind === 'add'}
            icon="add"
            onSelect={() => {
              setConnectorForm(EMPTY_CONNECTOR_FORM)
              setSelection({ kind: 'add' })
            }}
            title="Add connector"
          />
          {connectors.length > 0 && (
            <PanelListRow active={false} icon="export" onSelect={() => void exportConnectors()} title="Export JSON" />
          )}
        </div>
      </ListColumn>
      <DetailColumn>
        {selection?.kind === 'add' ? (
          <ConnectorEditor
            form={connectorForm}
            onChange={setConnectorForm}
            onSaved={() => {
              void runIxSync().then(() => refreshHealth(true))
            }}
          />
        ) : selectedConnector ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                {selectedConnector.label}
              </h3>
              <Badge variant="muted">{bundleLabel(selectedConnector.category)}</Badge>
              {!selectedConnector.enabled && <Badge variant="warn">disabled org-wide</Badge>}
            </div>
            {lampBadge(lampFor(selectedConnector.id))}
            {lampFor(selectedConnector.id)?.detail && (
              <p className="text-[0.68rem] leading-relaxed text-muted-foreground/70">
                {lampFor(selectedConnector.id)?.detail}
              </p>
            )}
            <PanelMeta
              rows={[
                { label: 'Connector id', value: <code className="font-mono text-[0.68rem]">{selectedConnector.id}</code> },
                {
                  label: 'MCP URL',
                  value: <code className="break-all font-mono text-[0.68rem]">{selectedConnector.url}</code>
                },
                { label: 'Transport', value: selectedConnector.transport },
                { label: 'Auth header', value: selectedConnector.authHeader },
                { label: 'Token', value: selectedConnector.hasToken ? 'stored server-side' : 'none' },
                ...(selectedConnector.appIds.length ? [{ label: 'Apps', value: selectedConnector.appIds.join(', ') }] : []),
                ...(selectedConnector.bundles.length
                  ? [{ label: 'Bundles', value: selectedConnector.bundles.map(bundleLabel).join(', ') }]
                  : []),
                ...(selectedConnector.readOnlyTools.length
                  ? [{ label: 'Read-only', value: selectedConnector.readOnlyTools.join(', ') }]
                  : [])
              ]}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => {
                  setConnectorForm(
                    formFromDraft({
                      appIds: selectedConnector.appIds,
                      authHeader: selectedConnector.authHeader,
                      bundles: selectedConnector.bundles,
                      category: selectedConnector.category,
                      enabled: selectedConnector.enabled,
                      id: selectedConnector.id,
                      label: selectedConnector.label,
                      readOnlyTools: selectedConnector.readOnlyTools,
                      transport: selectedConnector.transport,
                      url: selectedConnector.url
                    })
                  )
                  setSelection({ kind: 'add' })
                }}
                size="sm"
                variant="outline"
              >
                <Codicon name="edit" size="0.8125rem" />
                Edit
              </Button>
              <Button
                onClick={() => void patchConnector(selectedConnector, !selectedConnector.enabled)}
                size="sm"
                variant="outline"
              >
                <Codicon name={selectedConnector.enabled ? 'circle-slash' : 'check'} size="0.8125rem" />
                {selectedConnector.enabled ? 'Disable org-wide' : 'Enable org-wide'}
              </Button>
              <Button
                className="ml-auto"
                onClick={() => void deleteConnector(selectedConnector)}
                size="sm"
                variant="ghost"
              >
                <Codicon name="trash" size="0.8125rem" />
                Delete
              </Button>
            </div>
            <p className="text-[0.68rem] leading-relaxed text-muted-foreground/70">
              Registered through the admin portal&apos;s dynamic connector registry (super-admin). Disable org-wide to
              pull it from everyone; the switch in the list only hides it on this machine.
            </p>
          </div>
        ) : selectedTile ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{selectedTile.label}</h3>
              {selectedTile.group && <Badge variant="muted">{selectedTile.group}</Badge>}
            </div>
            {lampBadge(lampFor(selectedTile.id))}
            {lampFor(selectedTile.id)?.detail && (
              <p className="text-[0.68rem] leading-relaxed text-muted-foreground/70">
                {lampFor(selectedTile.id)?.detail}
              </p>
            )}
            {selectedTile.blurb && <p className="text-xs leading-relaxed text-muted-foreground">{selectedTile.blurb}</p>}
            <PanelMeta
              rows={[
                { label: 'Tile id', value: <code className="font-mono text-[0.68rem]">{selectedTile.id}</code> },
                {
                  label: 'MCP URL',
                  value: <code className="break-all font-mono text-[0.68rem]">{selectedTile.mcpUrl}</code>
                },
                ...(selectedTile.mcpAuthHint ? [{ label: 'Auth', value: selectedTile.mcpAuthHint }] : [])
              ]}
            />
            <p className="text-[0.68rem] leading-relaxed text-muted-foreground/70">
              Add this MCP server to the agent via Capabilities → MCP, or reach every tile at once through the
              admin-mcp gateway (Connect tab).
            </p>
          </div>
        ) : (
          <PanelEmpty
            description="Every MCP tool the org's admin-mcp gateway fans out to, plus your dynamic connectors — all attached automatically at sign-in. Lamps: green = tools/list works, grey = auth required, red = unreachable."
            icon="plug"
            title="Org MCP tools"
          />
        )}
      </DetailColumn>
    </MasterDetail>
  )
}
