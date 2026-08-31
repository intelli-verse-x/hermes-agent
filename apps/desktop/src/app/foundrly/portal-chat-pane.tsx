import { useEffect, useRef, useState } from 'react'

import { BRAND } from '@/lib/brand'

import { FoundrlyMark } from './foundrly-mark'
import { applyFoundrlyPortalBrand } from './portal-brand-inject'

/**
 * Guest partition for the live admin portal copilot.
 * Marker for check-brand-separation — do not rename lightly:
 *   persist:foundrly-portal
 */
export const FOUNDRLY_PORTAL_PARTITION = 'persist:foundrly-portal'

const ADMIN_CHAT_URL =
  BRAND.foundrly?.adminChatUrl ?? 'https://admin.intelli-verse-x.ai/admin/portal/chat'
const ADMIN_PORTAL_URL =
  BRAND.foundrly?.adminPortalUrl ?? 'https://admin.intelli-verse-x.ai/admin/portal'

type PortalWebview = HTMLElement & {
  getURL?: () => string
  loadURL?: (url: string) => void
  reload?: () => void
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>
  insertCSS?: (css: string) => Promise<string>
}

async function openExternal(url: string) {
  const bridge = window.hermesDesktop?.foundrly
  if (bridge?.openUrl) {
    await bridge.openUrl(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

function isPortalHost(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'admin.intelli-verse-x.ai' || host.endsWith('.intelli-verse-x.ai')
  } catch {
    return false
  }
}

/** Detect guest login chrome so we can cover Intelli Verse art with Foundrly. */
async function guestLooksLikeLogin(webview: PortalWebview): Promise<boolean | null> {
  if (typeof webview.executeJavaScript !== 'function') {
    return null
  }

  try {
    const result = await webview.executeJavaScript(
      `(() => {
        const text = (document.body && document.body.innerText) || '';
        const hasPassword = Boolean(document.querySelector('input[type="password"]'));
        const hasLoginCopy = /\\bLog\\s*In\\b/i.test(text) || /Enter your email/i.test(text);
        const hasIntelli = /Intelli\\s*Verse/i.test(text);
        return Boolean(hasPassword || hasLoginCopy || hasIntelli);
      })()`,
      false
    )
    return Boolean(result)
  } catch {
    return null
  }
}

/**
 * Same AdminCopilotChat operators use in Intelliverse-X-Webfrontend at
 * /admin/portal/chat (OTP + scoped tools). Desktop chrome is Foundrly-branded.
 * Left login art is covered by a Foundrly panel (guest site still ships IVX art).
 */
export function FoundrlyPortalChat() {
  const hostRef = useRef<HTMLDivElement>(null)
  const webviewRef = useRef<PortalWebview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Cover Intelli Verse left panel until guest no longer looks like login.
  const [showFoundrlyCover, setShowFoundrlyCover] = useState(true)

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    host.replaceChildren()
    const webview = document.createElement('webview') as PortalWebview
    webview.className = 'h-full w-full flex-1 bg-white'
    webview.setAttribute('partition', FOUNDRLY_PORTAL_PARTITION)
    webview.setAttribute('src', ADMIN_CHAT_URL)
    webview.setAttribute('allowpopups', '')
    webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes')

    const syncGuestBrand = () => {
      void applyFoundrlyPortalBrand(webview).catch(() => {
        /* best-effort text replace inside guest */
      })

      void guestLooksLikeLogin(webview).then(isLogin => {
        if (isLogin === null) {
          // Can't inspect guest — keep Foundrly cover so IVX art stays hidden.
          setShowFoundrlyCover(true)
          return
        }
        setShowFoundrlyCover(isLogin)
      })
    }

    const onStart = () => {
      setLoadError(null)
      setLoading(true)
      setShowFoundrlyCover(true)
    }
    const onStop = () => {
      setLoading(false)
      syncGuestBrand()
    }
    const onDomReady = () => syncGuestBrand()
    const onFail = (event: Event) => {
      const detail = event as Event & {
        errorCode?: number
        errorDescription?: string
        validatedURL?: string
      }
      if (detail.errorCode === -3) {
        return
      }
      setLoading(false)
      setLoadError(detail.errorDescription || detail.validatedURL || 'Failed to load admin copilot')
    }

    webview.addEventListener('did-start-loading', onStart)
    webview.addEventListener('did-stop-loading', onStop)
    webview.addEventListener('dom-ready', onDomReady)
    webview.addEventListener('did-finish-load', onDomReady)
    webview.addEventListener('did-navigate', onDomReady)
    webview.addEventListener('did-navigate-in-page', onDomReady)
    webview.addEventListener('did-fail-load', onFail)
    host.appendChild(webview)
    webviewRef.current = webview

    const poll = window.setInterval(() => syncGuestBrand(), 2000)

    return () => {
      window.clearInterval(poll)
      webview.removeEventListener('did-start-loading', onStart)
      webview.removeEventListener('did-stop-loading', onStop)
      webview.removeEventListener('dom-ready', onDomReady)
      webview.removeEventListener('did-finish-load', onDomReady)
      webview.removeEventListener('did-navigate', onDomReady)
      webview.removeEventListener('did-navigate-in-page', onDomReady)
      webview.removeEventListener('did-fail-load', onFail)
      webview.remove()
      webviewRef.current = null
    }
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0B1220]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <FoundrlyMark />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-300/90">
              Foundrly
            </p>
            <p className="truncate text-sm font-semibold text-[#E7ECF5]">Admin copilot</p>
            <p className="truncate text-xs text-white/55">
              Email OTP, then Foundrly-scoped portal tools.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="rounded-lg border border-white/15 px-2.5 py-1 text-xs font-semibold text-white/80 hover:bg-white/5"
            type="button"
            onClick={() => webviewRef.current?.reload?.()}
          >
            Reload
          </button>
          <button
            className="rounded-lg border border-white/15 px-2.5 py-1 text-xs font-semibold text-white/80 hover:bg-white/5"
            type="button"
            onClick={() => void openExternal(ADMIN_CHAT_URL)}
          >
            Open in browser
          </button>
          <button
            className="rounded-lg border border-white/15 px-2.5 py-1 text-xs font-semibold text-white/80 hover:bg-white/5"
            type="button"
            onClick={() => void openExternal(ADMIN_PORTAL_URL)}
          >
            Tools grid
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={hostRef}
          className="absolute inset-0"
          data-foundrly-portal={FOUNDRLY_PORTAL_PARTITION}
          data-portal-src={ADMIN_CHAT_URL}
        />
        {showFoundrlyCover ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 z-20 flex w-1/2 min-w-[16rem] max-w-[50%] items-center justify-center bg-[#0B1220] px-8"
            data-foundrly-login-cover="1"
          >
            <div className="flex max-w-sm flex-col items-start gap-4 text-left">
              <FoundrlyMark className="h-[72px] w-[72px] rounded-2xl border-teal-500/40" />
              <div>
                <p className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                  Foundrly
                </p>
                <p className="mt-3 text-base text-teal-200/90 sm:text-lg">
                  AI co-founder for local businesses.
                </p>
              </div>
            </div>
          </div>
        ) : null}
        {loading ? (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-[#0B1220]/40 text-sm text-white/70">
            Loading Foundrly admin copilot…
          </div>
        ) : null}
        {loadError ? (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[#0B1220] px-6 text-center">
            <p className="text-sm text-white/80">{loadError}</p>
            <button
              className="rounded-lg bg-teal-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400"
              type="button"
              onClick={() => {
                setLoadError(null)
                const current = webviewRef.current
                if (current?.loadURL) {
                  current.loadURL(ADMIN_CHAT_URL)
                  return
                }
                current?.setAttribute('src', ADMIN_CHAT_URL)
              }}
            >
              Retry
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export { isPortalHost }
