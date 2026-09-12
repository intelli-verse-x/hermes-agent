export interface EntitlementDecision {
  allowed: boolean
  reason: 'allowed' | 'cooldown' | 'premium-required'
  retryAt?: number
}

interface EntitlementRecord {
  active?: boolean
  expires_at?: string
  product_id?: string
  status?: string
}

const INACTIVE_ENTITLEMENT_STATUSES = new Set(['cancelled_immediately', 'expired', 'inactive', 'revoked'])

export function hasActiveEntitlement(value: unknown, productId: string, now = Date.now()): boolean {
  const expected = new Set([productId, productId.replace(/^qv_/, ''), `qv_${productId.replace(/^qv_/, '')}`])

  if (productId.includes('voyage')) {
    ;['qv_voyage_pass', 'voyage_pass', 'voyage', 'voyage_monthly', 'voyage_yearly'].forEach(id => expected.add(id))
  }

  const visit = (raw: unknown): boolean => {
    if (typeof raw === 'string') {
      return expected.has(raw)
    }

    if (Array.isArray(raw)) {
      return raw.some(visit)
    }

    if (!raw || typeof raw !== 'object') {
      return false
    }
    const item = raw as EntitlementRecord & Record<string, unknown>
    const status = String(item.status ?? '').toLowerCase()

    if (item.active === false || INACTIVE_ENTITLEMENT_STATUSES.has(status)) {
      return false
    }

    const expiry = item.expires_at ?? item.expiresAt ?? item.expirationDate ?? item.expires_date

    if (expiry !== undefined) {
      const expiresAt = Date.parse(String(expiry))

      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        return false
      }
    }

    for (const field of [
      'product_id',
      'productId',
      'entitlement',
      'entitlement_id',
      'entitlementId',
      'entitlement_ids',
      'tier'
    ]) {
      if (visit(item[field])) {
        return true
      }
    }

    const activeMap = item.active

    if (activeMap && typeof activeMap === 'object' && !Array.isArray(activeMap)) {
      for (const [id, active] of Object.entries(activeMap as Record<string, unknown>)) {
        if (expected.has(id) && active !== false && active != null) {
          return true
        }
      }
    }

    for (const [key, child] of Object.entries(item)) {
      if (expected.has(key)) {
        if (child === true) {
          return true
        }

        if (child && typeof child === 'object' && !Array.isArray(child)) {
          const record = child as EntitlementRecord & Record<string, unknown>
          const childStatus = String(record.status ?? '').toLowerCase()
          const childExpiry = record.expires_at ?? record.expiresAt ?? record.expirationDate ?? record.expires_date

          const active =
            record.active !== false &&
            !INACTIVE_ENTITLEMENT_STATUSES.has(childStatus) &&
            (childExpiry === undefined ||
              (Number.isFinite(Date.parse(String(childExpiry))) && Date.parse(String(childExpiry)) > now))

          if (active) {
            return true
          }
        }
      }

      if (typeof child === 'object' && child !== null && visit(child)) {
        return true
      }
    }

    return false
  }

  return visit(value)
}

export function entitlementDecision(input: {
  cooldownUntil?: number
  now?: number
  premium: boolean
  requiresPremium?: boolean
}): EntitlementDecision {
  const now = input.now ?? Date.now()

  if (input.requiresPremium && !input.premium) {
    return { allowed: false, reason: 'premium-required' }
  }

  if ((input.cooldownUntil ?? 0) > now) {
    return { allowed: false, reason: 'cooldown', retryAt: input.cooldownUntil }
  }

  return { allowed: true, reason: 'allowed' }
}
