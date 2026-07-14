import { atom } from 'nanostores'

import { $tutorStatus, autoStartTutorOnce } from './store'

const TENANT_KEY = 'quizverse_tutorx_tenant'

interface TutorRequestFormField {
  data?: ArrayBuffer
  filename?: string
  name: string
  type?: string
  value?: string
}

interface TutorWsBridgeEvent {
  data?: unknown
  id: string
  type: 'close' | 'error' | 'message' | 'open'
}

export const $tutorApiError = atom<null | string>(null)

export function tutorTenantId(): string {
  const existing = localStorage.getItem(TENANT_KEY)

  if (existing) {return existing}
  const id = `quizverse-desktop-${crypto.randomUUID()}`
  localStorage.setItem(TENANT_KEY, id)

  return id
}

export async function tutorApiBase(): Promise<string> {
  await autoStartTutorOnce()
  const status = $tutorStatus.get()
  const base = status?.apiUrl || (status?.mode === 'remote' ? status.webUrl : '')

  if (!base) {throw new Error('TutorX API is not available')}

  return base.replace(/\/+$/, '')
}

export async function tutorFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const bridge = window.hermesDesktop?.quizverse

  if (bridge?.tutorRequest) {
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    let form: TutorRequestFormField[] | undefined
    let body = typeof init.body === 'string' ? init.body : undefined

    if (init.body instanceof FormData) {
      form = []
      for (const [name, value] of init.body.entries()) {
        if (value instanceof File) {
          form.push({
            data: await value.arrayBuffer(),
            filename: value.name,
            name,
            type: value.type
          })
        } else {
          form.push({ name, value })
        }
      }
      body = undefined
    }

    const result = await bridge.tutorRequest({ body, form, headers, method: init.method, path })

    if (result.status < 200 || result.status >= 300) {
      throw new Error(result.body || `TutorX request failed (${result.status})`)
    }

    return (result.body ? JSON.parse(result.body) : null) as T
  }

  const base = await tutorApiBase()
  const headers = new Headers(init.headers)
  headers.set('x-user-id', tutorTenantId())

  if (init.body && !(init.body instanceof FormData)) {headers.set('content-type', 'application/json')}
  const response = await fetch(`${base}${path}`, { ...init, headers })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || `${response.status} ${response.statusText}`)
  }

  $tutorApiError.set(null)

  return (await response.json()) as T
}

export interface TutorSocket {
  onclose: (() => void) | null
  onerror: (() => void) | null
  onmessage: ((event: { data: string }) => void) | null
  onopen: (() => void) | null
  readonly readyState: number
  close: () => void
  send: (data: string) => void
}

export async function createTutorSocket(path: string): Promise<TutorSocket> {
  const bridge = window.hermesDesktop?.quizverse

  if (!bridge?.tutorWsConnect) {
    return new WebSocket(await tutorWsUrl(path)) as unknown as TutorSocket
  }

  let id = ''
  let state: number = WebSocket.CONNECTING
  const queued: TutorWsBridgeEvent[] = []
  const socket: TutorSocket = {
    close: () => {
      state = WebSocket.CLOSING
      if (id) {
        void bridge.tutorWsClose(id)
      }
    },
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    get readyState() {
      return state
    },
    send: data => {
      if (!id || state !== WebSocket.OPEN) {
        throw new Error('TutorX WebSocket is not open')
      }

      void bridge.tutorWsSend(id, data).catch(() => socket.onerror?.())
    }
  }
  const dispatch = (event: TutorWsBridgeEvent) => {
    if (!id) {
      queued.push(event)

      return
    }

    if (event.id !== id) {
      return
    }

    if (event.type === 'open') {
      state = WebSocket.OPEN
      socket.onopen?.()
    } else if (event.type === 'message') {
      socket.onmessage?.({ data: String(event.data ?? '') })
    } else if (event.type === 'error') {
      socket.onerror?.()
    } else {
      state = WebSocket.CLOSED
      socket.onclose?.()
      unsubscribe()
    }
  }
  const unsubscribe = bridge.onTutorWsEvent(dispatch)

  id = await bridge.tutorWsConnect(path, tutorTenantId())
  queued.splice(0).forEach(dispatch)

  return socket
}

export async function tutorStream(path: string, onEvent: (event: Record<string, unknown>) => void): Promise<void> {
  const bridge = window.hermesDesktop?.quizverse

  if (bridge?.tutorStreamStart) {
    let buffer = ''

    return new Promise((resolve, reject) => {
      let id = ''
      const queued: { data?: unknown; id: string; type: 'data' | 'done' | 'error' }[] = []
      const dispatch = (event: { data?: unknown; id: string; type: 'data' | 'done' | 'error' }) => {
        if (!id) {
          queued.push(event)

          return
        }

        if (event.id !== id) {
          return
        }

        if (event.type === 'error') {
          unsubscribe()
          reject(new Error(String(event.data ?? 'TutorX stream failed')))

          return
        }

        if (event.type === 'done') {
          unsubscribe()
          resolve()

          return
        }

        buffer += String(event.data ?? '')
        const frames = buffer.split('\n\n')

        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          const raw = frame.split('\n').find(line => line.startsWith('data:'))?.slice(5).trim()

          if (raw) {
            try {
              onEvent(JSON.parse(raw) as Record<string, unknown>)
            } catch {
              onEvent({ message: raw })
            }
          }
        }
      }
      const unsubscribe = bridge.onTutorStreamEvent(dispatch)

      void bridge.tutorStreamStart(path).then(streamId => {
        id = streamId
        queued.splice(0).forEach(dispatch)
      }).catch(error => {
        unsubscribe()
        reject(error)
      })
    })
  }

  const base = await tutorApiBase()
  const response = await fetch(`${base}${path}`, { headers: { 'x-user-id': tutorTenantId() } })

  if (!response.ok || !response.body) {
    throw new Error(`TutorX event stream failed (${response.status})`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      return
    }

    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')

    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const raw = frame.split('\n').find(line => line.startsWith('data:'))?.slice(5).trim()

      if (raw) {
        try {
          onEvent(JSON.parse(raw) as Record<string, unknown>)
        } catch {
          onEvent({ message: raw })
        }
      }
    }
  }
}

export async function tutorWsUrl(path: string): Promise<string> {
  const base = await tutorApiBase()
  const url = new URL(path, `${base}/`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('user_id', tutorTenantId())

  return url.toString()
}
