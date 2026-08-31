import type * as React from 'react'

import { BRAND } from '@/lib/brand'
import { desktopAssetPath } from '@/lib/desktop-asset-path'
import { cn } from '@/lib/utils'

/** Shared Foundrly mark — same 40×40 size on Home and Admin copilot chrome. */
export const FOUNDRLY_MARK_CLASS =
  'h-10 w-10 shrink-0 rounded-xl border border-teal-500/30 object-contain'

export function FoundrlyMark({ className, ...props }: React.ComponentProps<'img'>) {
  return (
    <img
      alt=""
      className={cn(FOUNDRLY_MARK_CLASS, className)}
      height={40}
      src={desktopAssetPath(BRAND.markSvg)}
      width={40}
      {...props}
    />
  )
}
