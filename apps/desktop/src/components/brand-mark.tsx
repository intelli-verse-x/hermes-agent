import { BRAND } from '@/lib/brand'
import { cn } from '@/lib/utils'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

// Brand badge: the active brand's monogram on a white tile, identical in
// light/dark. Fills the tile (softly rounded); size via className (default
// size-14). The mark asset in public/ is resolved from the brand manifest.
export function BrandMark({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white',
        className
      )}
      {...props}
    >
      <img alt="" className="size-full object-contain p-0.5" src={assetPath(BRAND.markSvg)} />
    </span>
  )
}
