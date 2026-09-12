const VOICE_RESTRICTED_PATTERNS: Array<[RegExp, string]> = [
  [/^\s*\/yolo\b/i, 'Voice cannot enable automatic approval.'],
  [/\b(?:approve|allow)\s+(?:for\s+)?(?:this\s+)?session\b/i, 'Voice cannot grant session approval.'],
  [/\b(?:always|permanently)\s+(?:approve|allow)\b/i, 'Voice cannot grant permanent approval.'],
  [
    /\b(?:approve once|confirm action|structured approval|grant approval)\b/i,
    'Use the structured confirmation control.'
  ],
  [
    /\b(?:my\s+)?(?:password|passcode|one[- ]time password|otp|verification code|api key|secret|credential)\s*(?:is|:)\s*\S+/i,
    'Secrets and credentials must be entered through the protected input control.'
  ],
  [
    /\b(?:grant|revoke|change|modify|enable|disable)\s+(?:[a-z-]+\s+){0,3}(?:permission|permissions|access|role|roles)\b/i,
    'Voice cannot authorize permission changes.'
  ]
]

export function voiceSubmissionBlockReason(text: string): string | null {
  for (const [pattern, reason] of VOICE_RESTRICTED_PATTERNS) {
    if (pattern.test(text)) {
      return reason
    }
  }

  return null
}

export function assertVoiceSubmissionAllowed(text: string): void {
  const reason = voiceSubmissionBlockReason(text)

  if (reason) {
    throw new Error(reason)
  }
}
