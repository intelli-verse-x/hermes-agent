// Captured shapes transcribed from the production request/response builders:
// - Nakama data/modules/src/games/quizverse/migration.ts
// - Nakama data/modules/src/{legacy/{quiz,wallet,leaderboards},tournaments/rpcs}.ts
// - Unity HomeScreen.cs, FriendsNakamaModels.cs, AsyncChallengeData.cs,
//   KnowledgeMapModels.cs, QuizVerseSDK.Matchmaking.cs, ArcadeNakamaService.cs
// - QuizVerse web game-rpc and TutorX callers.
const profile = {
  gameId: 'quizverse',
  success: true,
  profile: {
    avatarUrl: '',
    badges: { displayed: [], total: 0 },
    league: { rank: 0, score: 0, tier: 'bronze' },
    level: 1,
    stats: { currentLevel: 1, totalGamesPlayed: 0, totalWins: 0, totalXp: 0 },
    totalXp: 0,
    userId: 'fixture-guest',
    username: 'Fixture Guest',
    wallet: { coins: 0, gems: 0 },
    xp: 0,
    xpToNextLevel: 100
  },
  timestamp: '2026-07-13T00:00:00Z'
}
const session = {
  success: true,
  session: {
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_086_400_000,
    finalResult: null,
    gameId: 'quizverse',
    playerA: { displayName: 'Fixture Guest', isComplete: false, score: 0, userId: 'fixture-guest' },
    playerB: null,
    questions: [],
    quizConfig: {},
    quizModeName: 'Daily Quiz',
    quizModeType: 2,
    sessionId: 'session-fixture',
    shareCode: 'ABC123',
    status: 0
  }
}
const sourceQuestions = [
  { id: 'src-1', question: 'Which planet is known as the Red Planet?', options: ['Mars', 'Venus', 'Earth', 'Jupiter'], correct_index: 0, explanation: 'Iron oxide makes Mars red.', topic: 'space' },
  { id: 'src-2', question: 'What is the largest ocean?', options: ['Pacific', 'Atlantic', 'Indian', 'Arctic'], correct_index: 0, topic: 'geography' },
  { id: 'src-3', question: 'Who wrote Hamlet?', options: ['Shakespeare', 'Austen', 'Dickens', 'Homer'], correct_index: 0, topic: 'literature' },
  { id: 'src-4', question: 'What is H2O?', options: ['Water', 'Oxygen', 'Hydrogen', 'Salt'], correct_index: 0, topic: 'science' }
]

export const QUIZ_FETCH_ROUTE_FIXTURES = Object.freeze({
  request: Object.freeze({
    args: {
      count: 4,
      id_prefix: 'daily',
      inline_questions: sourceQuestions,
      kind: 'daily',
      mode: 'DailyQuiz',
      scope: 'global',
      source: 'request',
      topic: 'daily'
    },
    response: {
      context_pack_version: 'v1',
      meta: {},
      ok: true,
      question_pack_id: 'pk_fixture',
      questions: sourceQuestions,
      repeat_policy: { fresh_count: 4, pool_exhausted: false, review_count: 0 },
      seen_snapshot: [],
      source_trace: { kind: 'daily', served_by: 'quizverse_quiz_generate' }
    },
    rpc: 'quizverse_request_questions'
  }),
  weekly: Object.freeze({
    args: {
      iso_day: 1,
      iso_week: 29,
      iso_year: 2026,
      lang_code: 'en',
      source: 'weekly',
      type: 'health'
    },
    response: {
      raw_json: JSON.stringify({
        questions: [
          { id: 'm1', question: 'Capital of France?', options: ['Paris', 'Rome', 'Berlin', 'Madrid'], answer: 0, topic: 'geography' },
          { id: 'm2', question: '2 + 2 = ?', options: ['3', '4', '5', '6'], correctIndex: 1, topic: 'math' },
          { id: 'm3', question: 'H2O is?', choices: ['Water', 'Salt', 'Gold', 'Iron'], correct: 'Water', topic: 'science' },
          sourceQuestions[0]
        ]
      })
    },
    rpc: 'quizverse_weekly_fetch'
  }),
  external: Object.freeze({
    args: { provider: 'jikan', source: 'external' },
    response: {
      data: [
        { title: 'Cowboy Bebop', title_english: 'Cowboy Bebop', images: { jpg: { image_url: 'https://cdn.example/cowboy.jpg', large_image_url: 'https://cdn.example/cowboy-large.jpg' } } },
        { title: 'Monster', title_english: 'Monster', images: { jpg: { image_url: 'https://cdn.example/monster.jpg' } } },
        { title: 'Frieren', title_english: 'Frieren', images: { jpg: { image_url: 'https://cdn.example/frieren.jpg' } } },
        { title: 'Steins;Gate', title_english: 'Steins;Gate', images: { jpg: { image_url: 'https://cdn.example/steins.jpg' } } }
      ]
    },
    rpc: 'quizverse_fetch_external_quiz'
  }),
  news: Object.freeze({
    args: { lang: 'en', source: 'news' },
    response: {
      articles: [
        { title: 'Scientists map a distant world', description: 'A new observation.', imageUrl: 'https://cdn.example/news-1.jpg', sourceName: 'Science Daily', category: 'Science', publishedAt: '2026-07-12T12:00:00Z' },
        { title: 'City opens a new public library', description: 'Readers attended.', imageUrl: 'https://cdn.example/news-2.jpg', sourceName: 'City Wire', category: 'Culture', publishedAt: '2026-07-12T11:00:00Z' },
        { title: 'Team wins a dramatic final', description: 'The match went late.', imageUrl: 'https://cdn.example/news-3.jpg', sourceName: 'Sports Desk', category: 'Sports', publishedAt: '2026-07-12T10:00:00Z' },
        { title: 'Researchers improve battery recycling', description: 'Less waste.', imageUrl: 'https://cdn.example/news-4.jpg', sourceName: 'Tech Journal', category: 'Technology', publishedAt: '2026-07-12T09:00:00Z' }
      ],
      cached: false,
      source: 'gnews',
      success: true
    },
    rpc: 'quizverse_fetch_news_quiz'
  }),
  movies: Object.freeze({
    args: { country: 'US', lang: 'en', source: 'movies' },
    response: {
      cached: false,
      movies: [
        { title: 'Arrival', posterUrl: 'https://cdn.example/arrival.jpg', year: '2016', overview: 'A linguist meets visitors.' },
        { title: 'Moonlight', posterUrl: 'https://cdn.example/moonlight.jpg', year: '2016', overview: 'A coming-of-age story.' },
        { title: 'Parasite', posterUrl: 'https://cdn.example/parasite.jpg', year: '2019', overview: 'Two families become entangled.' },
        { title: 'Spirited Away', posterUrl: 'https://cdn.example/spirited.jpg', year: '2001', overview: 'A journey through a spirit world.' }
      ],
      source: 'tmdb',
      success: true
    },
    rpc: 'quizverse_fetch_movies_quiz'
  }),
  music: Object.freeze({
    args: { country: 'US', source: 'music' },
    response: {
      artists: [
        { artistName: 'Beyoncé', imageUrl: 'https://cdn.example/beyonce.jpg', playcount: '1000' },
        { artistName: 'Radiohead', imageUrl: 'https://cdn.example/radiohead.jpg', playcount: '900' },
        { artistName: 'Bad Bunny', imageUrl: 'https://cdn.example/badbunny.jpg', playcount: '800' },
        { artistName: 'SZA', imageUrl: 'https://cdn.example/sza.jpg', playcount: '700' }
      ],
      cached: false,
      country: 'US',
      success: true
    },
    rpc: 'quizverse_fetch_music_quiz'
  })
})

export const EXTERNAL_PROVIDER_FIXTURES = Object.freeze({
  jikan: QUIZ_FETCH_ROUTE_FIXTURES.external.response,
  pokeapi: {
    count: 4,
    next: null,
    previous: null,
    results: [1, 4, 7, 25].map((id, index) => ({
      name: ['bulbasaur', 'charmander', 'squirtle', 'pikachu'][index],
      url: `https://pokeapi.co/api/v2/pokemon/${id}/`
    }))
  },
  themealdb: {
    meals: ['Arrabiata', 'Sushi', 'Tacos', 'Laksa'].map((name, index) => ({
      idMeal: String(100 + index),
      strMeal: name,
      strMealThumb: `https://cdn.example/meal-${index}.jpg`
    }))
  },
  ghibli: ['Spirited Away', 'Totoro', 'Ponyo', 'Kiki'].map((title, index) => ({
    image: `https://cdn.example/ghibli-${index}.jpg`,
    movie_banner: `https://cdn.example/ghibli-banner-${index}.jpg`,
    title
  })),
  countries: ['India', 'Japan', 'Brazil', 'Kenya'].map((common, index) => ({
    flags: { png: `https://cdn.example/flag-${index}.png`, svg: `https://cdn.example/flag-${index}.svg` },
    name: { common }
  })),
  disney: {
    data: ['Mickey Mouse', 'Moana', 'Mulan', 'Simba'].map((name, index) => ({
      imageUrl: `https://cdn.example/disney-${index}.jpg`,
      name
    }))
  },
  nasa: {
    collection: {
      items: ['Orion Nebula', 'Mars', 'Saturn', 'Earth'].map((title, index) => ({
        data: [{ title }],
        links: [{ href: `https://cdn.example/nasa-${index}.jpg` }]
      }))
    }
  },
  starwars: [
    { eye_color: 'blue', name: 'Luke Skywalker' },
    { eye_color: 'yellow', name: 'C-3PO' },
    { eye_color: 'brown', name: 'Leia Organa' },
    { eye_color: 'red', name: 'Darth Maul' }
  ],
  dog: {
    message: [
      'https://images.dog.ceo/breeds/retriever-golden/one.jpg',
      'https://images.dog.ceo/breeds/terrier-sealyham/two.jpg',
      'https://images.dog.ceo/breeds/hound-afghan/three.jpg',
      'https://images.dog.ceo/breeds/spaniel-cocker/four.jpg'
    ],
    status: 'success'
  },
  sports: {
    teams: ['Arsenal', 'Barcelona', 'Bayern Munich', 'Inter Milan'].map((strTeam, index) => ({
      strBadge: `https://cdn.example/team-${index}.png`,
      strTeam,
      strTeamBadge: ''
    }))
  }
})

export const WEEKLY_RAW_JSON_FIXTURES = Object.freeze({
  rootArray: [
    {
      category: 'Geography',
      correct_answer: 0,
      difficulty: 'easy',
      id: 101,
      image: 'https://cdn.example/flag.png',
      options: [
        { text: 'India' },
        { option: 'Japan' },
        { label: 'Brazil' },
        { answer: 'Kenya' },
        { value: 'Canada' }
      ],
      prompt: 'Which country uses this flag?'
    }
  ],
  questions: {
    questions: [
      {
        category: 'Science',
        correct_index: 1,
        difficulty: 'medium',
        explanation: 'Four is the sum.',
        id: 'weekly-q',
        media_url: 'https://cdn.example/math.png',
        options: ['3', '4', '5', '6'],
        question: 'What is 2 + 2?'
      },
      {
        correctIndex: 0,
        id: 'weekly-camel',
        options: ['Pacific', 'Atlantic'],
        question: 'Largest ocean?'
      }
    ]
  },
  items: {
    items: [{
      choices: ['Mars', 'Venus', 'Earth', 'Jupiter'],
      correctAnswer: 0,
      mediaUrl: 'https://cdn.example/mars.png',
      questionId: 'weekly-item',
      questionText: 'Which planet is red?',
      theme: 'space'
    }]
  },
  data: {
    data: [{
      answer: 1,
      audio: 'https://cdn.example/audio.mp3',
      options: ['Piano', 'Guitar'],
      text: 'Which instrument is playing?',
      type: 'audio'
    }]
  },
  results: {
    results: [
      {
        correct: 'Water',
        options: ['Water', 'Salt'],
        prompt: 'What is H2O?',
        questionId: 'weekly-result',
        video: 'https://cdn.example/water.mp4'
      },
      {
        answer: 'True',
        media: 'https://cdn.example/earth.jpg',
        options: ['True', 'False'],
        prompt: 'Earth orbits the Sun.',
        type: 'true-false'
      },
      {
        prompt: 'Explain gravity.',
        type: 'subjective'
      }
    ]
  }
})

export const WEEKLY_RAW_JSON_NEGATIVE_FIXTURES = Object.freeze({
  missingWrapper: { entries: [] },
  noPrompt: { questions: [{ options: ['A', 'B'], correct_index: 0 }] },
  oneOption: { items: [{ prompt: 'Broken', options: ['A'], correct_answer: 0 }] },
  outOfRange: { data: [{ prompt: 'Broken', options: ['A', 'B'], correctIndex: 2 }] },
  unknownAnswer: { results: [{ prompt: 'Broken', choices: ['A', 'B'], correct: 'C' }] }
})

export const RESPONSE_FIXTURES = Object.freeze({
  qv_profile_get: profile,
  qv_stats_get: {
    success: true,
    data: {
      averageScore: 0,
      bestStreak: 0,
      currentStreak: 0,
      favoriteCategory: '',
      lastPlayedAt: 0,
      totalCorrectAnswers: 0,
      totalGamesPlayed: 0,
      totalQuestions: 0,
      userId: 'fixture-guest',
      winRate: 0
    }
  },
  qv_context_get: {
    ok: true,
    pack: {
      activity: { abandon_7d: 0, completion_7d: 0, last_quiz_ms: 0 },
      affinity: { topics: [] },
      country: '',
      device: 'desktop',
      experiments: [],
      flags: {},
      issued_ms: 1_700_000_000_000,
      locale: 'en-US',
      safety: { level: 'default' },
      tier: 'free',
      user_id: 'fixture-guest',
      version: 'v1'
    }
  },
  qv_quiz_fetch: QUIZ_FETCH_ROUTE_FIXTURES.request.response,
  qv_quiz_history: { success: true, data: { cursor: '', results: [] } },
  qv_quiz_stats: {
    success: true,
    data: {
      averageScore: 0,
      lastPlayedAt: 0,
      totalCorrect: 0,
      totalGames: 0,
      totalQuestions: 0
    }
  },
  qv_leaderboard_get: {
    success: true,
    data: {
      game_id: 'quizverse',
      leaderboard_id: 'leaderboard_quizverse_alltime',
      next_cursor: '',
      period: 'alltime',
      prev_cursor: '',
      records: []
    }
  },
  qv_wallet_get: {
    success: true,
    data: {
      conversion: { canConvert: false, globalEquivalent: 0, minConvertAmount: 100, ratio: 100 },
      currencies: { game: 0, global: 0, xut: 0 },
      game_balance: 0,
      gameId: 'quizverse',
      global_balance: 0,
      timestamp: '2026-07-13T00:00:00Z',
      userId: 'fixture-guest'
    }
  },
  qv_entitlements_get: {
    success: true,
    data: { consumables: {}, one_time: {}, subscriptions: {} }
  },
  qv_friends_list: {
    success: true,
    data: { count: 0, nextCursor: null, results: [] }
  },
  qv_tournaments_list: {
    success: true,
    data: { served_at: 1_700_000_000, tournaments: [] }
  },
  qv_async_status: session,
  qv_knowledge_map: {
    categories: {},
    error: null,
    overall_coverage_pct: 0,
    strongest: null,
    success: true,
    total_quizzes: 0,
    weakest: null
  },
  qv_tutorx_progress: { items: [] },
  qv_tutorx_sessions: { sessions: [], total: 0 },
  qv_quiz_submit: {
    correct: 1,
    graded: [{
      correct_index: 0,
      is_correct: true,
      latency_ms: 20,
      question_id: 'q1',
      scored_server: true,
      selected_index: 0
    }],
    ok: true,
    score: 1000,
    scoring_version: 'v2',
    total: 1,
    v1_persisted: true,
    v1_result: { success: true }
  },
  qv_quiz_sync_score: {
    bonuses: [],
    game_id: 'quizverse',
    leaderboards_updated: ['leaderboard_quizverse'],
    reward_currency: 'coins',
    reward_details: { base: 10 },
    reward_earned: 10,
    score: 1000,
    success: true,
    wallet_balance: 110
  },
  qv_friend_invite: {
    error: null,
    inviteId: 'invite-fixture',
    status: 'pending',
    success: true,
    targetUserId: 'user-2'
  },
  qv_friend_challenge: {
    challengeId: 'fchg_fixture',
    correlationId: null,
    error: null,
    errorCode: null,
    expiresAt: '2026-07-14T00:00:00Z',
    fromUserId: 'fixture-guest',
    gameId: 'quizverse',
    isAsync: true,
    retryAfterMs: 0,
    roomCode: null,
    shareCode: 'ABC123',
    status: 'pending',
    success: true,
    timestamp: '2026-07-13T00:00:00Z',
    toUserId: 'user-2'
  },
  qv_async_create: session,
  qv_async_join: session,
  qv_async_submit: session,
  qv_tournament_enter: {
    success: true,
    data: {
      entry: {
        bc_charged: 25,
        enrolled_at: 1_700_000_000,
        entry_id: 'ent_fixture',
        founder_member: false,
        paid_via: 'balance',
        score: 0,
        tournament_slug: 'weekly-cup',
        user_id: 'fixture-guest'
      },
      founder_member: false,
      idempotent: false
    }
  },
  qv_reward_claim: {
    success: true,
    data: { nextReward: 110, rewardAmount: 100, streak: 1 }
  },
  qv_party_create: {
    createdAt: '2026-07-13T00:00:00Z',
    error: null,
    leaderId: 'fixture-guest',
    maxSize: 4,
    partyId: 'party-fixture',
    success: true
  },
  qv_party_join: {
    error: null,
    maxSize: 4,
    memberCount: 1,
    members: [{ displayName: 'Fixture Guest', skillLevel: 1, userId: 'fixture-guest' }],
    partyId: 'party-fixture',
    success: true
  },
  qv_party_status: {
    error: null,
    matchId: null,
    players: [],
    searchTimeSeconds: 0,
    status: 'searching',
    success: true,
    ticketId: 'ticket-fixture'
  }
})
