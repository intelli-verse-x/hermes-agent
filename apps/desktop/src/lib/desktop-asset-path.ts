/**
 * Resolve a file under `public/` for Electron + Vite (`base: './'`).
 *
 * Plain `${BASE_URL}${path}` breaks on SPA deep routes in dev
 * (e.g. `/foundrly` + `./foundrly/mark-512.png` → `/foundrly/foundrly/...`).
 * Packaged `file://` builds still need a path relative to `index.html`.
 */
export function desktopAssetPath(relativePath: string): string {
  const cleaned = relativePath.replace(/^\/+/, '')
  const base = import.meta.env.BASE_URL || '/'

  if (base === './' || base === '.' || base === '') {
    if (typeof window !== 'undefined') {
      if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        return `/${cleaned}`
      }

      if (window.location.protocol === 'file:') {
        const directory = window.location.href.replace(/[#?].*$/, '').replace(/[^/\\]*$/, '')
        return new URL(cleaned, directory).href
      }
    }

    return `./${cleaned}`
  }

  return `${base.endsWith('/') ? base : `${base}/`}${cleaned}`
}
