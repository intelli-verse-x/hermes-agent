export type NativeSurfaceId =
  | 'words'
  | 'voyage'
  | 'tournaments'
  | 'link-play'
  | 'brain'
  | 'notes'
  | 'live'
  | 'voice'
  | 'onboarding'
  | 'shell'
  | 'tutorx'

export interface NativeRouteContract {
  description: string
  id: string
  protocol?: string
  write?: boolean
}

export interface NativeSurfaceContract {
  accent: string
  auth: 'cognito' | 'guest' | 'guest-or-cognito'
  description: string
  icon: string
  id: NativeSurfaceId
  label: string
  routes: readonly NativeRouteContract[]
}

const route = (id: string, description: string, protocol?: string, write = false): NativeRouteContract => ({
  description,
  id,
  protocol,
  write
})

export const NATIVE_SURFACES: readonly NativeSurfaceContract[] = [
  {
    accent: 'qv-toon-creative',
    auth: 'guest-or-cognito',
    description: 'Daily word puzzles, parties, and vocabulary duels.',
    icon: 'quizverse/brain-icons/orphans.webp',
    id: 'words',
    label: 'Words',
    routes: [
      route('daily', 'Six-attempt daily word grid.', 'GET /api/words/daily'),
      route('groups', 'Sort sixteen words into four hidden groups.'),
      route('spell', 'Build words around the required center letter.'),
      route('crossword', 'Solve the native daily clue grid.'),
      route('imposter', 'Pass-and-play secret-word party.'),
      route(
        'duel',
        'Vocabulary duel and ranked results.',
        'quizverse_words_duel_get / quizverse_words_duel_submit',
        true
      ),
      route('about', 'Rules, scoring, privacy, and content provenance.')
    ]
  },
  {
    accent: 'qv-toon-special',
    auth: 'guest-or-cognito',
    description: 'A six-planet daily brain workout.',
    icon: 'quizverse/brain-icons/path.webp',
    id: 'voyage',
    label: 'Voyage',
    routes: [
      route('hub', 'Daily route, progress, hints, and cooldown.'),
      route('trivia', 'Rapid multiple-choice planet.'),
      route('memory', 'Native card-pair memory planet.'),
      route('wordblock', 'Unscramble the daily word planet.'),
      route('picture', 'Identify the image clue planet.'),
      route('search', 'Find the hidden term planet.'),
      route('premium', 'Complete the Premium Tile Match planet.'),
      route('pass', 'Voyage Pass entitlement and tier policy.', 'GET /api/voyage/tier')
    ]
  },
  {
    accent: 'qv-toon-premium',
    auth: 'cognito',
    description: 'Competition packs, brackets, learning tracks, and awards.',
    icon: 'quizverse/brain-icons/recap.webp',
    id: 'tournaments',
    label: 'Tournaments',
    routes: [
      route('hub', 'Browse active and upcoming competitions.', 'tournament_list'),
      route('detail', 'Rules, pot, eligibility, and entry options.', 'tournament_get'),
      route('age-gate', 'Age eligibility and KYC setup state.', '/api/kyc/age/status'),
      route('enroll', 'Enter through balance or free AMOE path.', 'tournament_enter', true),
      route('play', 'Play a server-issued tournament question pack.', 'quizverse_get_questions'),
      route('picks', 'Submit tournament pick selections.', 'tournament_submit_picks', true),
      route('bracket', 'Native bracket rounds and match state.', 'tournament_bracket_state'),
      route('leaderboard', 'Global, league, and friends standings.', 'tournament_leaderboard_top'),
      route('certificate', 'Claim and view earned certificates.', 'tournament_claim_certificate', true),
      route('referral', 'Referral code and invited-player state.', 'tournament_referral_get'),
      route('learning', 'Competition learning tracks.', 'learning_track_get'),
      route('intent', 'Intent quiz and tournament recommendation.', 'tournament_intent_quiz_get')
    ]
  },
  {
    accent: 'qv-toon-ai',
    auth: 'cognito',
    description: 'Turn notes and media into active learning.',
    icon: 'quizverse/brain-icons/chat.webp',
    id: 'link-play',
    label: 'Link & Play',
    routes: [
      route('library', 'Search and filter saved learning notes.', 'GET /api/ai/notes'),
      route('create', 'Create from URL, text, document, image, or audio.', 'POST /api/ai/notes', true),
      route('note', 'Note details and generation jobs.', 'GET /api/ai/notes/:id'),
      route('quiz', 'Generated quiz runner.'),
      route('flashcards', 'Generated flashcard study.'),
      route('chat', 'Grounded streaming note chat.', 'POST /api/ai/notes/:id/chat (SSE)', true),
      route('arena', 'Knowledge arena matchmaking.', 'Nakama realtime'),
      route('battle', 'Head-to-head note battle.', 'Nakama realtime'),
      route('explainer', 'Explainer video job and status.', 'POST /api/ai/notes/:id/generate-explainer-video', true),
      route('srs', 'Spaced-repetition queue.', 'GET /api/ai/flashcards/srs/queue'),
      route('debate', 'Guided and timed debate modes.', 'POST /api/ai/notes/:id/debate/start', true),
      route('mind-map', 'Native note mind map.', 'POST /api/ai/notes/:id/mindmap', true),
      route('speed-read', 'Adjustable paced reading.', 'POST /api/ai/notes/:id/speed-reading', true),
      route('audiobook', 'Audiobook generation and playback.', 'POST /api/ai/audiobook/create', true),
      route('figurine', 'Preview and generate a figurine.', 'GET/POST /api/ai/notes/:id/figurine-*', true)
    ]
  },
  {
    accent: 'qv-toon-ai',
    auth: 'cognito',
    description: 'Explore concepts, gaps, bridges, and readiness.',
    icon: 'quizverse/brain-icons/map.webp',
    id: 'brain',
    label: 'Brain',
    routes: [
      route('graph', 'Interactive native knowledge graph.', 'GET /api/ai/graph'),
      route('hubs', 'High-connectivity concept hubs.', 'GET /api/ai/graph/hubs'),
      route('orphans', 'Unconnected concepts needing review.', 'GET /api/ai/graph/orphans'),
      route('bridge', 'Bridge-pair quiz runner.', 'GET /api/ai/graph/bridge-quiz'),
      route('path', 'Personalized learning path.', 'GET /api/ai/graph/learning-path'),
      route('readiness', 'Exam readiness and mastery.', 'GET /api/ai/graph/readiness'),
      route('recap', 'Recent progress recap.'),
      route('chat', 'Grounded graph chat.', 'POST /api/ai/multimedia/chat-v2 (SSE)', true)
    ]
  },
  {
    accent: 'qv-toon-knowledge',
    auth: 'cognito',
    description: 'Retention queue, library, and study tools.',
    icon: 'quizverse/brain-icons/hubs.webp',
    id: 'notes',
    label: 'Notes & Retention',
    routes: [
      route('srs', 'Due-card queue and review.', 'GET/POST /api/ai/flashcards/srs/*', true),
      route('streak', 'Learner streak and check-in.', 'GET/POST /api/ai/learner/streak', true),
      route('library', 'Saved learning content.', 'GET /api/ai/library'),
      route('share', 'Native share creation and redemption.', 'POST /api/ai/note-share', true),
      route('microlearning', 'Daily and note microlearning.', 'POST /api/ai/learner/*microlearning', true),
      route('mind-map', 'Note and user mind maps.', 'POST /api/ai/learner/*mind-map', true),
      route('audio', 'Audio overview generation.', 'POST /api/ai/learner/audio-overview', true),
      route('image-occlusion', 'Image occlusion card editor.', 'POST /api/ai/flashcards/srs/image-occlusion', true)
    ]
  },
  {
    accent: 'qv-toon-social',
    auth: 'guest-or-cognito',
    description: 'Create, join, and run timed community events.',
    icon: 'quizverse/brain-icons/hubs.webp',
    id: 'live',
    label: 'Live Events',
    routes: [
      route('browse', 'Browse published events.', 'creator_event_list'),
      route('draft', 'Create and edit an event draft.', 'creator_event_create/update', true),
      route('publish', 'Publish an eligible funded event.', 'creator_event_publish', true),
      route('join', 'Join with an event code.', 'creator_event_join', true),
      route('round', 'Timed native question rounds.', 'creator_event_submit', true),
      route('monitor', 'Creator attendance and answer monitor.', 'Nakama realtime'),
      route('leaderboard', 'Live and final standings.', 'creator_event_get'),
      route('prizes', 'Funding, distribution, and refund state.', 'creator_event_fund/distribute_rewards', true)
    ]
  },
  {
    accent: 'qv-toon-media',
    auth: 'cognito',
    description: 'Voice and text sessions with AI quiz personas.',
    icon: 'quizverse/brain-icons/chat.webp',
    id: 'voice',
    label: 'AI Voice & Host',
    routes: [
      route('personas', 'Browse free and premium personas.', 'GET /api/ai/ai-voice/personas'),
      route('session', 'Create, inspect, and end a session.', 'POST /api/ai/ai-voice/sessions', true),
      route('text', 'Send text and poll messages.', 'POST /api/ai/ai-voice/sessions/:id/text', true),
      route('audio', 'Microphone, audio commit, and playback.', 'LiveKit + /audio + /commit', true),
      route('entitlement', 'Free cap and premium product states.', 'GET /api/ai/ai-voice/entitlements')
    ]
  },
  {
    accent: 'qv-toon-special',
    auth: 'guest-or-cognito',
    description: 'Choose a learning pathway and complete first-run setup.',
    icon: 'quizverse/brain-icons/path.webp',
    id: 'onboarding',
    label: 'Onboarding',
    routes: [
      route('intent', 'Choose learning intent and goals.'),
      route('pathway', 'Scholar, Warrior, or Explorer pathway.'),
      route('quiz', 'Native placement quiz.'),
      route('brain-code', 'Review the generated learner profile.'),
      route('account', 'Continue as guest or complete Cognito sign-in.'),
      route('plan', 'Free and premium plan choice.'),
      route('complete', 'Emit a desktop deep-link completion payload.')
    ]
  },
  {
    accent: 'qv-toon-social',
    auth: 'guest-or-cognito',
    description: 'Profile, quests, social, commerce, and saved content.',
    icon: 'quizverse/brain-icons/recap.webp',
    id: 'shell',
    label: 'App & Library',
    routes: [
      route('home', 'Personalized native home.'),
      route('profile', 'Player profile and progression.', 'player_get_full_profile'),
      route('streak', 'Cross-surface daily streak.'),
      route('quests', 'Daily missions and achievements.', 'progression_get_state'),
      route('shop', 'Products and inventory setup state.', 'shop_list_products'),
      route('clans', 'Clan membership and invite state.', 'clan_get'),
      route('library', 'Saved notes, games, and learning content.', 'GET /api/ai/library')
    ]
  },
  {
    accent: 'qv-toon-knowledge',
    auth: 'guest-or-cognito',
    description: 'Exam preparation, tools, groups, and progress.',
    icon: 'quizverse/brain-icons/readiness.webp',
    id: 'tutorx',
    label: 'TutorX Plus',
    routes: [
      route('exams', 'Exam catalog and pack entitlement.'),
      route('diagnostic', 'Diagnostic and guided learning path.'),
      route('calculators', 'GPA, countdown, and study calculators.'),
      route('scores', 'Native score report analyzer.'),
      route('battles', 'TutorX battle read paths.', 'async_challenge_get'),
      route('groups', 'Study group read paths.', 'friends_list'),
      route('referral', 'TutorX referral status.'),
      route('parent', 'Read-only parent progress summary.', 'GET /api/v1/learning/progress'),
      route('packs', 'Stripe exam-pack setup and entitlement state.')
    ]
  }
] as const

export function nativeSurface(id: NativeSurfaceId): NativeSurfaceContract {
  const surface = NATIVE_SURFACES.find(item => item.id === id)

  if (!surface) {
    throw new Error(`Unknown QuizVerse native surface: ${id}`)
  }

  return surface
}
