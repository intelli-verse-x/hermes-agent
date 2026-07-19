export type HandoffRole = 'system' | 'user' | 'assistant' | 'tool'

export interface TranscriptMessage {
  role: HandoffRole
  content: string
  toolCallId?: string
}

export interface HandoffLimits {
  maxCharacters: number
  maxTokens: number
  charactersPerToken?: number
}

export interface CompactHandoff {
  messages: TranscriptMessage[]
  characterCount: number
  estimatedTokens: number
  omittedMessages: number
  truncatedMessages: number
}

const TRUNCATION_MARKER = '…'

function boundedInteger(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.floor(value))
}

function truncate(content: string, budget: number): string {
  if (content.length <= budget) {
    return content
  }

  if (budget <= 0) {
    return ''
  }

  if (budget === 1) {
    return TRUNCATION_MARKER
  }

  return `${content.slice(0, budget - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`
}

/**
 * Builds a deterministic, content-capped cloud handoff. It deliberately omits
 * assistant chatter and unrelated tool output; callers identify tool results
 * that are required to continue the latest request.
 */
export function compactCloudHandoff(
  transcript: readonly TranscriptMessage[],
  relevantToolCallIds: readonly string[],
  limits: HandoffLimits
): CompactHandoff {
  const relevantIds = new Set(relevantToolCallIds)
  let latestSystem = -1
  let latestUser = -1

  transcript.forEach((message, index) => {
    if (message.role === 'system') {
      latestSystem = index
    }

    if (message.role === 'user') {
      latestUser = index
    }
  })

  const selectedIndexes = transcript
    .map((message, index) => ({ message, index }))
    .filter(
      ({ message, index }) =>
        index === latestSystem ||
        index === latestUser ||
        (message.role === 'assistant' &&
          typeof message.toolCallId === 'string' &&
          relevantIds.has(message.toolCallId)) ||
        (message.role === 'tool' && typeof message.toolCallId === 'string' && relevantIds.has(message.toolCallId))
    )
    .map(({ index }) => index)

  const charactersPerToken = Math.max(1, boundedInteger(limits.charactersPerToken ?? 4))

  let remainingCharacters = Math.min(
    boundedInteger(limits.maxCharacters),
    boundedInteger(limits.maxTokens) * charactersPerToken
  )

  let truncatedMessages = 0

  const messages = selectedIndexes.map((index, selectedIndex) => {
    const source = transcript[index]
    const messagesRemaining = selectedIndexes.length - selectedIndex
    const budget = Math.floor(remainingCharacters / messagesRemaining)
    const content = truncate(source.content, budget)

    if (content.length < source.content.length) {
      truncatedMessages += 1
    }

    remainingCharacters -= content.length

    return { ...source, content }
  })

  const characterCount = messages.reduce((total, message) => total + message.content.length, 0)

  return {
    messages,
    characterCount,
    estimatedTokens: Math.ceil(characterCount / charactersPerToken),
    omittedMessages: transcript.length - messages.length,
    truncatedMessages
  }
}
