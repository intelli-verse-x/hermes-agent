import { atom } from 'nanostores'

import type { NativeSurfaceId } from './native-contracts'

export interface NativeSurfaceLocation {
  route: string
  surface: NativeSurfaceId
}

export const $nativeSurfaceLocation = atom<NativeSurfaceLocation>({ route: 'daily', surface: 'words' })

export function openNativeSurface(surface: NativeSurfaceId, route?: string) {
  $nativeSurfaceLocation.set({ route: route ?? '', surface })
}
