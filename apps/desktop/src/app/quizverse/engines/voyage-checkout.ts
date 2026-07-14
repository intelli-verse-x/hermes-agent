export interface VoyageCheckoutAttempt {
  checkoutAttemptId: string
  createdAt: number
  period: 'monthly' | 'yearly'
  userId: string
}

export function reusableVoyageCheckoutAttempt(
  attempt: VoyageCheckoutAttempt | null,
  period: VoyageCheckoutAttempt['period'],
  userId: string,
  now = Date.now()
): VoyageCheckoutAttempt | null {
  if (
    !attempt ||
    attempt.period !== period ||
    attempt.userId !== userId ||
    now < attempt.createdAt ||
    now - attempt.createdAt > 3_600_000 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attempt.checkoutAttemptId)
  ) {
    return null
  }

  return attempt
}
