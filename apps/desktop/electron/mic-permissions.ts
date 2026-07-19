export interface ApprovedRendererLocations {
  developmentOrigin?: string | null
  packagedRendererPaths?: string[]
}

function canonicalFilePath(url: URL): string {
  return decodeURIComponent(url.pathname).replace(/\/+$/, '')
}

export function isApprovedRendererUrl(
  urlValue: unknown,
  locations: ApprovedRendererLocations
): boolean {
  if (typeof urlValue !== 'string' || !urlValue) {
    return false
  }

  try {
    const url = new URL(urlValue)

    if (url.protocol === 'file:') {
      const requestedPath = canonicalFilePath(url)

      return (locations.packagedRendererPaths ?? []).some(candidate => {
        try {
          const approved = new URL(candidate)

          return approved.protocol === 'file:' && canonicalFilePath(approved) === requestedPath
        } catch {
          return false
        }
      })
    }

    if (!locations.developmentOrigin) {
      return false
    }

    const approved = new URL(locations.developmentOrigin)

    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === approved.origin
  } catch {
    return false
  }
}

export const isApprovedMicrophoneOrigin = isApprovedRendererUrl

export function isApprovedMicrophoneRequestContext(
  request: {
    details?: { isMainFrame?: boolean; mediaType?: string; mediaTypes?: string[] }
    hasApprovedWindow: boolean
    pageUrl?: string
    permission: unknown
    requestingUrl?: string
    trustedPreload: boolean
  },
  locations: ApprovedRendererLocations
): boolean {
  return Boolean(
    request.hasApprovedWindow &&
    request.trustedPreload &&
    request.details?.isMainFrame !== false &&
    isApprovedRendererUrl(request.requestingUrl, locations) &&
    isApprovedRendererUrl(request.pageUrl, locations) &&
    isAudioOnlyPermission(request.permission, request.details)
  )
}

export function isAudioOnlyPermission(permission: unknown, details: { mediaType?: string; mediaTypes?: string[] } = {}) {
  if (permission !== 'media' && permission !== 'audioCapture') {
    return false
  }

  if (details.mediaType === 'video') {
    return false
  }

  if (Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0) {
    return details.mediaTypes.includes('audio') && !details.mediaTypes.includes('video')
  }

  return true
}
