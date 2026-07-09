// Renderer side of the IX Agency auto-attach sync: the main process pulls the
// gateway MCP directory, dynamic connectors and the live org-skills catalog on
// every successful OTP login (and on boot with a live session), then pushes
// the result here over sync:event. Tabs subscribe to $ixSync instead of
// wiring their own refresh buttons.
import { atom, onMount } from 'nanostores'

import type { IxAgencySyncState } from '@/global'
import { Codecs, persistentAtom } from '@/lib/persisted'

import skillsData from './data/skills.json'
import type { IxSkillItem } from './types'

export const $ixSync = atom<IxAgencySyncState | null>(null)

onMount($ixSync, () => {
  const bridge = window.hermesDesktop?.ixAgency

  if (!bridge?.syncGet) {
    return
  }

  void bridge
    .syncGet()
    .then(state => $ixSync.set(state))
    .catch(() => {})

  return bridge.onSyncEvent?.(state => $ixSync.set(state))
})

/** Trigger a re-sync (login already does this automatically main-side). */
export async function runIxSync(): Promise<void> {
  const bridge = window.hermesDesktop?.ixAgency

  if (!bridge?.syncRun) {
    return
  }

  $ixSync.set(await bridge.syncRun())
}

// ── Per-tile enable/disable ─────────────────────────────────────────────────
// Local preference (this machine): disabled tiles render dimmed with the
// switch off and stay out of the copilot's attachable tool surface.
export const $ixDisabledMcpTiles = persistentAtom<string[]>(
  'hermes.desktop.ixAgency.disabledMcpTiles',
  [],
  Codecs.stringArray
)

export function setMcpTileEnabled(tileId: string, enabled: boolean) {
  const current = $ixDisabledMcpTiles.get()

  $ixDisabledMcpTiles.set(enabled ? current.filter(id => id !== tileId) : [...new Set([...current, tileId])])
}

// ── Live org skills ─────────────────────────────────────────────────────────

// Bundled snapshot of the portal's admin-skills catalog, used until the
// post-login sync delivers the live one.
const BUNDLED_SKILLS: IxSkillItem[] = Array.isArray((skillsData as { items?: unknown }).items)
  ? ((skillsData as { items: unknown }).items as IxSkillItem[])
  : []

/** Live catalog from the last sync, falling back to the bundled snapshot. */
export function orgSkillCatalog(sync: IxAgencySyncState | null): IxSkillItem[] {
  return sync?.orgSkills.length ? sync.orgSkills : BUNDLED_SKILLS
}
