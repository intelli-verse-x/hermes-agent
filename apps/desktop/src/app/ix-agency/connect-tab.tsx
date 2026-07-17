import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'
import type { IxAgencyRendererSettings, IxAgencyVpnStatus, IxHermesStatus } from '@/global'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'

import { Field } from './bits'

const VPN_DOT: Record<IxAgencyVpnStatus['state'], string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500 animate-pulse',
  disconnected: 'bg-neutral-400',
  unavailable: 'bg-neutral-400',
  unknown: 'bg-amber-500'
}

const VPN_LABEL: Record<IxAgencyVpnStatus['state'], string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  disconnected: 'Disconnected',
  unavailable: 'Not set up',
  unknown: 'Unknown'
}

const STATUS_POLL_MS = 10_000

export function intelliversePublicText(value: string): string {
  return value
    .replace(/hermes[-\s]?deployment/gi, 'Intelliverse installer')
    .replace(/\.hermes/gi, 'Intelliverse runtime storage')
    .replace(/\bHermes(?: Agent)?\b/gi, 'Intelliverse')
}

function publicRuntimeStatus(status: IxHermesStatus): IxHermesStatus {
  return { ...status, detail: intelliversePublicText(status.detail) }
}

export function ConnectTab() {
  const bridge = window.hermesDesktop?.ixAgency

  const [settings, setSettings] = useState<IxAgencyRendererSettings | null>(null)
  const [vpn, setVpn] = useState<IxAgencyVpnStatus | null>(null)
  const [vpnBusy, setVpnBusy] = useState(false)
  // '' = leave stored secret untouched; save only sends it when non-empty.
  const [tokenDraft, setTokenDraft] = useState('')
  const [litellmKeyDraft, setLitellmKeyDraft] = useState('')
  const [cognitoSecretDraft, setCognitoSecretDraft] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'saving'>('idle')
  const [hermes, setHermes] = useState<IxHermesStatus | null>(null)
  const [cognitoBusy, setCognitoBusy] = useState(false)
  const [initBusy, setInitBusy] = useState(false)
  const [initLog, setInitLog] = useState('')
  const savedTimer = useRef<null | ReturnType<typeof setTimeout>>(null)

  const refreshVpn = useCallback(async () => {
    if (!bridge) {
      return
    }

    try {
      setVpn(await bridge.vpnStatus())
    } catch {
      // Status polls are best-effort; the last known state stays on screen.
    }
  }, [bridge])

  useEffect(() => {
    if (!bridge) {
      return
    }

    void bridge
      .getSettings()
      .then(setSettings)
      .catch(error => notifyError(error, 'Failed to load IVX Agency settings'))

    void bridge
      .hermesStatus?.()
      .then(status => setHermes(publicRuntimeStatus(status)))
      .catch(() => setHermes(null))

    void refreshVpn()
    const timer = setInterval(() => void refreshVpn(), STATUS_POLL_MS)

    return () => {
      clearInterval(timer)

      if (savedTimer.current) {
        clearTimeout(savedTimer.current)
      }
    }
  }, [bridge, refreshVpn])

  if (!bridge) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-6 text-xs text-muted-foreground">
        The IVX Agency bridge is unavailable in this build.
      </div>
    )
  }

  if (!settings) {
    return null
  }

  const patch = (partial: Partial<IxAgencyRendererSettings>) => setSettings({ ...settings, ...partial })

  const save = async () => {
    setSaveState('saving')

    try {
      const next = await bridge.saveSettings({
        portalUrl: settings.portalUrl,
        gatewayUrl: settings.gatewayUrl,
        vpnConfPath: settings.vpnConfPath,
        vpnExitIp: settings.vpnExitIp,
        litellmUrl: settings.litellmUrl,
        customChatModels: settings.customChatModels,
        updateManifestUrl: settings.updateManifestUrl,
        cognitoOauth2Url: settings.cognitoOauth2Url,
        cognitoClientId: settings.cognitoClientId,
        cognitoScope: settings.cognitoScope,
        ...(tokenDraft ? { gatewayToken: tokenDraft } : {}),
        ...(litellmKeyDraft ? { litellmKey: litellmKeyDraft } : {}),
        ...(cognitoSecretDraft ? { cognitoClientSecret: cognitoSecretDraft } : {})
      })

      setSettings(next)
      setTokenDraft('')
      setLitellmKeyDraft('')
      setCognitoSecretDraft('')
      setSaveState('saved')
      savedTimer.current = setTimeout(() => setSaveState('idle'), 2000)
    } catch (error) {
      setSaveState('idle')
      notifyError(error, 'Failed to save IVX Agency settings')
    }
  }

  const toggleVpn = async () => {
    setVpnBusy(true)

    try {
      setVpn(vpn?.state === 'connected' ? await bridge.vpnDisconnect() : await bridge.vpnConnect())
    } catch (error) {
      notifyError(error, 'VPN action failed')
      void refreshVpn()
    } finally {
      setVpnBusy(false)
    }
  }

  const pickConf = async () => {
    const result = await bridge.pickVpnConf()

    if (!result.canceled && result.path) {
      patch({ vpnConfPath: result.path })
    }
  }

  const importConf = async () => {
    try {
      const result = await bridge.importVpnConf()

      if (result.imported) {
        notify({ message: 'VPN profile imported', detail: result.detail })
        setSettings(await bridge.getSettings())
        void refreshVpn()
      }
    } catch (error) {
      notifyError(error, 'VPN import failed')
    }
  }

  const validateCognito = async () => {
    setCognitoBusy(true)

    try {
      const result = await bridge.cognitoValidate({
        clientId: settings?.cognitoClientId,
        ...(cognitoSecretDraft ? { clientSecret: cognitoSecretDraft } : {})
      })

      notify({ message: 'Cognito S2S credentials verified', detail: result.detail })
      setCognitoSecretDraft('')
      setSettings(await bridge.getSettings())
      setHermes(publicRuntimeStatus(await bridge.hermesStatus()))
    } catch (error) {
      notifyError(error, 'Cognito validation failed')
    } finally {
      setCognitoBusy(false)
    }
  }

  const runHermesInit = async () => {
    setInitBusy(true)
    setInitLog('')

    try {
      const result = await bridge.hermesInit()

      setInitLog(intelliversePublicText(result.log))
      notify({ message: 'Agent runtime initialized', detail: 'LiteLLM gateway wired as the model provider' })
      setHermes(publicRuntimeStatus(await bridge.hermesStatus()))
      setSettings(await bridge.getSettings())
    } catch (error) {
      notifyError(
        new Error(intelliversePublicText(error instanceof Error ? error.message : String(error))),
        'Intelliverse runtime init failed'
      )
    } finally {
      setInitBusy(false)
    }
  }

  const vpnState = vpn?.state ?? 'unknown'

  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      <div className="mx-auto max-w-2xl space-y-6 px-5 py-4">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Guided first-run checklist</h3>
          <ul className="grid gap-2 text-xs sm:grid-cols-2">
            <li className="rounded-md bg-(--ui-bg-quinary) px-3 py-2">
              1. Email OTP and portal entitlement — completed before this workspace opens
            </li>
            <li className="rounded-md bg-(--ui-bg-quinary) px-3 py-2">
              2. Assigned gateway and model credentials —{' '}
              {settings.gatewayTokenSet && settings.litellmKeySet
                ? 'present'
                : 'needs administrator provisioning or override'}
            </li>
            <li className="rounded-md bg-(--ui-bg-quinary) px-3 py-2">
              3. VPN backend/profile —{' '}
              {settings.vpnConfImported || settings.vpnConfPath ? VPN_LABEL[vpnState] : 'profile not configured'}
            </li>
            <li className="rounded-md bg-(--ui-bg-quinary) px-3 py-2">
              4. Confidential runtime client —{' '}
              {settings.cognitoClientSecretSet ? 'stored; validate or rotate below' : 'not provisioned'}
            </li>
            <li className="rounded-md bg-(--ui-bg-quinary) px-3 py-2 sm:col-span-2">
              5. Local agent runtime — {hermes?.initialized ? 'initialized' : hermes?.detail || 'not initialized'}
            </li>
          </ul>
          <p className="text-[0.68rem] leading-relaxed text-muted-foreground/70">
            Provisioning steps can fail independently. Retry the affected control below or ask the credential owner to
            issue, rotate, or revoke access. IVX Agency does not grant portal roles or bypass server-side authorization.
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Company VPN (usa-vpn · WireGuard)</h3>
          <div className="flex items-center gap-3 rounded-md bg-(--ui-bg-quinary) px-3 py-2.5">
            <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', VPN_DOT[vpnState])} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-foreground">{VPN_LABEL[vpnState]}</div>
              {vpn?.detail && <div className="truncate text-[0.68rem] text-muted-foreground/70">{vpn.detail}</div>}
            </div>
            <Button
              disabled={vpnBusy || vpnState === 'unavailable' || vpnState === 'connecting'}
              onClick={() => void toggleVpn()}
              size="sm"
              variant={vpnState === 'connected' ? 'secondary' : 'default'}
            >
              {vpnBusy ? <Codicon name="loading~spin" size="0.8125rem" /> : null}
              {vpnState === 'connected' ? 'Disconnect' : 'Connect'}
            </Button>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-(--ui-bg-quinary) px-3 py-2.5">
            <Codicon
              className={settings.vpnConfImported ? 'text-emerald-500' : 'text-muted-foreground/50'}
              name={settings.vpnConfImported ? 'key' : 'circle-slash'}
              size="0.875rem"
            />
            <span className="min-w-0 flex-1 text-xs">
              {settings.vpnConfImported
                ? 'usa-vpn.conf is stored as operating-system-protected ciphertext through Electron safeStorage.'
                : 'No protected profile is stored. Sign-in may import an assigned profile; otherwise ask your administrator or import one manually.'}
            </span>
            <Button onClick={() => void importConf()} size="sm" variant="secondary">
              {settings.vpnConfImported ? 'Re-import…' : 'Import .conf…'}
            </Button>
          </div>
          <Field label="WireGuard profile path (fallback when nothing is imported)">
            <div className="flex gap-2">
              <Input
                className="flex-1"
                onChange={e => patch({ vpnConfPath: e.target.value })}
                placeholder="/path/to/usa-vpn.conf"
                value={settings.vpnConfPath}
              />
              <Button onClick={() => void pickConf()} size="sm" variant="secondary">
                Browse…
              </Button>
            </div>
          </Field>
          <Field label="Expected VPN egress IP (Lightsail exit)">
            <Input
              onChange={e => patch({ vpnExitIp: e.target.value })}
              placeholder="3.224.15.124"
              value={settings.vpnExitIp}
            />
          </Field>
          <p className="text-[0.68rem] leading-relaxed text-muted-foreground/70">
            For eligible accounts, sign-in attempts to fetch the profile assigned by the portal; retrieval can be
            unavailable, denied, expired, or revoked. Manual import remains an override. Connecting prompts for an
            OS-admin password and requires wireguard-tools on macOS/Linux or WireGuard for Windows. The status lamp
            turns green only after a fresh handshake and verified egress through the configured exit IP.
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Org endpoints</h3>
          <Field label="Admin portal URL">
            <Input
              onChange={e => patch({ portalUrl: e.target.value })}
              placeholder="https://admin.intelli-verse-x.ai"
              value={settings.portalUrl}
            />
          </Field>
          <Field label="admin-mcp gateway URL">
            <Input
              onChange={e => patch({ gatewayUrl: e.target.value })}
              placeholder="https://admin-mcp.intelli-verse-x.ai/"
              value={settings.gatewayUrl}
            />
          </Field>
          <Field
            label={
              settings.gatewayTokenSet ? 'Gateway bearer token (saved — enter to replace)' : 'Gateway bearer token'
            }
          >
            <Input
              onChange={e => setTokenDraft(e.target.value)}
              placeholder={settings.gatewayTokenSet ? '••••••••' : 'Bearer token'}
              type="password"
              value={tokenDraft}
            />
          </Field>
          <div className="flex items-center gap-2">
            <Button disabled={saveState === 'saving'} onClick={() => void save()} size="sm">
              {saveState === 'saving' ? 'Saving…' : 'Save'}
            </Button>
            {saveState === 'saved' && (
              <span className="text-[0.68rem] text-muted-foreground">
                <Codicon className="mr-1 inline-block text-emerald-500" name="check" size="0.75rem" />
                Saved
              </span>
            )}
          </div>
          <p className="text-[0.68rem] leading-relaxed text-muted-foreground/70">
            Eligible accounts may receive a tenant-scoped token after sign-in. Leave this empty to keep the stored value
            or enter an administrator-issued replacement. Electron safeStorage protects the local ciphertext; the
            issuing portal owns scope, rotation, expiry, and revocation. The token powers only tools authorized for the
            signed-in account.
          </p>
        </section>

        {/* ── Native copilot (LiteLLM) ── */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground/70 uppercase">
            Native copilot (LiteLLM)
          </h3>
          <Field label="LiteLLM base URL">
            <Input
              onChange={e => patch({ litellmUrl: e.target.value })}
              placeholder="https://litellm.intelli-verse-x.ai"
              value={settings.litellmUrl}
            />
          </Field>
          <Field label={settings.litellmKeySet ? 'LiteLLM API key (saved — enter to replace)' : 'LiteLLM API key'}>
            <Input
              onChange={e => setLitellmKeyDraft(e.target.value)}
              placeholder={settings.litellmKeySet ? '••••••••' : 'sk-…'}
              type="password"
              value={litellmKeyDraft}
            />
          </Field>
          <Field label="Extra chat models (comma-separated, optional)">
            <Input
              onChange={e => patch({ customChatModels: e.target.value })}
              placeholder="vendor/model-id, …"
              value={settings.customChatModels}
            />
          </Field>
          <p className="text-[0.68rem] leading-relaxed text-muted-foreground/70">
            Powers the Copilot tab for models and tools authorized to this account. Eligible accounts may receive a
            personal key after sign-in; provisioning is not guaranteed and an administrator can rotate or revoke it.
            Enter a replacement only when instructed. Electron safeStorage protects the local ciphertext. Portal OTP and
            server-side authorization are still required—possessing a key alone does not unlock the copilot.
          </p>
        </section>

        {/* ── Updates ── */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground/70 uppercase">Updates</h3>
          <Field label="Update feed URL">
            <Input
              onChange={e => patch({ updateManifestUrl: e.target.value })}
              placeholder="https://intelliverse-x-desktop.s3.amazonaws.com/ix-agency"
              value={settings.updateManifestUrl}
            />
          </Field>
          <p className="text-[0.68rem] leading-relaxed text-muted-foreground/70">
            Checked on launch and every 4 hours. The default is the official S3 feed that CI publishes on every release;
            when a newer version is there, a non-blocking "Update available" button appears in the strip above and the
            tray, and clicking it downloads, installs and restarts in place. A URL ending in .json is treated as a
            legacy hand-published manifest (the button opens the download instead).
          </p>
        </section>

        {/* ── Hermes init (Cognito S2S) ── */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground/70 uppercase">
            Agent runtime init (Cognito S2S)
          </h3>
          <div className="flex items-center gap-2 rounded-md bg-(--ui-bg-quinary) px-3 py-2.5">
            <Codicon
              className={hermes?.initialized ? 'text-emerald-500' : 'text-muted-foreground/50'}
              name={hermes?.initialized ? 'check' : 'circle-large-outline'}
              size="0.875rem"
            />
            <span className="min-w-0 flex-1 text-xs">
              {hermes ? hermes.detail : 'Checking local Intelliverse runtime…'}
            </span>
          </div>
          <Field label="Cognito OAuth2 token endpoint">
            <Input
              onChange={e => patch({ cognitoOauth2Url: e.target.value })}
              placeholder="https://…amazoncognito.com/oauth2/token"
              value={settings.cognitoOauth2Url}
            />
          </Field>
          <Field label="COGNITO_S2S_CLIENT_ID">
            <Input onChange={e => patch({ cognitoClientId: e.target.value })} value={settings.cognitoClientId} />
          </Field>
          <Field
            label={
              settings.cognitoClientSecretSet
                ? 'COGNITO_S2S_CLIENT_SECRET (saved — enter to replace)'
                : 'COGNITO_S2S_CLIENT_SECRET'
            }
          >
            <Input
              onChange={e => setCognitoSecretDraft(e.target.value)}
              placeholder={settings.cognitoClientSecretSet ? '••••••••' : 'Client secret'}
              type="password"
              value={cognitoSecretDraft}
            />
          </Field>
          <div className="flex items-center gap-2">
            <Button
              disabled={cognitoBusy || (!settings.cognitoClientSecretSet && !cognitoSecretDraft)}
              onClick={() => void validateCognito()}
              size="sm"
              variant="secondary"
            >
              {cognitoBusy ? 'Validating…' : 'Validate credentials'}
            </Button>
            <Button
              disabled={initBusy || !settings.cognitoClientSecretSet}
              onClick={() => void runHermesInit()}
              size="sm"
            >
              {initBusy
                ? 'Installing…'
                : hermes?.installerAvailable
                  ? 'Install local Intelliverse runtime'
                  : 'Initialize local Intelliverse runtime'}
            </Button>
          </div>
          {initLog && (
            <pre className="max-h-48 overflow-auto rounded bg-(--ui-bg-quaternary) p-2 font-mono text-[0.65rem] whitespace-pre-wrap">
              {initLog}
            </pre>
          )}
          <p className="text-[0.68rem] leading-relaxed text-muted-foreground/70">
            For eligible tenants, first sign-in attempts this sequence; use these controls to inspect or retry failures.
            The confidential S2S client secret is administrator-issued and is distinct from a public OAuth app client,
            which must not have a secret. Validation performs a client-credentials grant and verifies the token against
            the pool JWKS. Electron safeStorage protects local ciphertext before the installer initializes the local
            runtime and configures LiteLLM. The issuing services retain responsibility for rotation and revocation.
          </p>
        </section>
      </div>
    </div>
  )
}
