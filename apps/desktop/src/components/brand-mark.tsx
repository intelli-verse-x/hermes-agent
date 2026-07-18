import { BRAND } from '@/lib/brand'
import { cn } from '@/lib/utils'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

// Brand badge: monogram on a card-tone tile (theme token) so dark mode
// does not flash a hard-coded white square. Size via className (default size-14).
export function BrandMark({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-card',
        className
      )}
      {...props}
    >
      <img alt="" className="size-full object-contain p-0.5" src={assetPath(BRAND.markSvg)} />
    </span>
  )
}
