# QuizVerse Player MCP

A first-party, player-session-scoped MCP facade for QuizVerse. It is kept as a
self-contained package so it can move to a standalone repository without
changing its protocol.

## Architecture and authentication

The server speaks MCP over Electron-owned local socket transport; a secretless
stdio relay connects Hermes to that socket. It does not accept Nakama, Cognito, TutorX,
HTTP-key, or administrator credentials. QuizVerse Desktop provisions a local
IPC socket path and a per-launch random broker secret. Electron directly
spawns the MCP server with a four-variable minimal child environment; Hermes
launches only the secretless `relay.mjs` transport. The backend, terminal
descendants, config, and logs never receive the secret. Broker authentication
uses a constant-time comparison. Electron retains Nakama session and refresh
tokens in `safeStorage`.

Every brokered call is selected from a dedicated tool-to-RPC policy. The
Electron-owned Nakama host/session is QuizVerse-only, and contracts that carry
`game_id` or `gameId` are overwritten with `quizverse`.

Guest sessions may use normal profile, quiz, leaderboard, challenge, and
tournament reads. Wallet, entitlement, friend, and reward operations require an
authenticated player capability. No admin operation or arbitrary RPC proxy is
exposed.

## Safety

- Reads: 60 calls per rolling minute.
- Writes: 10 calls per rolling minute.
- A first write call cannot execute. Electron issues a short-lived challenge,
  displays a native approval dialog, and requires the exact challenge on the
  second call.
- Tournament entry and reward claim use a stronger value-bearing warning.
- RFC UUID idempotency is bound to player, tool, and canonical payload hash.
  Electron durably writes a pending claim before calling upstream, then stores
  the final result. A crash-window pending record is returned as unknown and
  is never retried automatically.
- Audit records contain operation, player id, tool, and outcome, but no
  credentials or request payloads.
- Broker and upstream calls have bounded timeouts.
- Unknown tools, RPCs, TutorX paths, and malformed input are rejected.
- The immutable contract manifest is shared by server and broker; Electron adds
  exact primitive, range, nested-answer, and unknown-key validation.
- Responses stay in a stable `data` envelope. Scalar, non-JSON, oversized,
  deeply nested, and credential-bearing responses are rejected rather than
  generically unwrapped.
- The server socket is mode `0600` on POSIX. Windows uses a cryptographically
  unguessable per-launch pipe name in addition to broker authentication; Node's
  pipe server inherits the current user's process-token DACL.

## Response compatibility

`response-contracts.mjs` is the authoritative response inventory. Every tool
has a named contract version, exact top-level keys, typed nested collections,
numeric ranges, and a normalizer to `{ contractVersion, success, data }`.
Electron validates and normalizes before a response crosses into MCP.

Current source-derived variants are intentionally narrow:

- `full-profile-v1`, `arcade-wallet-v1`,
  `arcade-daily-reward-v1`, `knowledge-map-v1`, and the three
  `matchmaking-*-v1` contracts mirror the Unity DTOs.
- `friends-phase4-v1` accepts the canonical `data.results` response and the
  one-release legacy top-level `friends` response documented by Unity.
- `async-unity-*-v1` accepts Unity's `session`, `data`, and direct-session
  wrappers while validating the same session fields and status range.
- `quiz-source-v1` accepts the direct Unity `questions` response and the web
  `data.questions` wrapper used by weekly/external/news/movies/music routes.
- TutorX progress accepts the observed array and `{ items }` forms; sessions
  use `{ sessions, total? }`. Unknown TutorX item fields remain opaque JSON
  because that external API has no versioned item DTO.
- Generic Nakama failure responses are limited to
  `{ success: false, error, errorCode?, retryAfterMs? }`.

Adding a backend response variant requires a source fixture, a new or amended
named schema, and a compatibility note here. Unknown top-level fields are
rejected unless a contract explicitly documents an evolving nested object.

## Tool matrix

Reads:

- `qv_profile_get`, `qv_stats_get`, `qv_context_get`
- `qv_quiz_fetch`, `qv_quiz_history`, `qv_quiz_stats`
- `qv_leaderboard_get`
- `qv_wallet_get`, `qv_entitlements_get`
- `qv_friends_list`
- `qv_tournaments_list`, `qv_async_status`
- `qv_knowledge_map`, `qv_tutorx_progress`, `qv_tutorx_sessions`
- `qv_party_status`

Confirmed writes:

- `qv_quiz_submit`, `qv_quiz_sync_score`
- `qv_friend_invite`, `qv_friend_challenge`
- `qv_async_create`, `qv_async_join`, `qv_async_submit`
- `qv_tournament_enter`, `qv_reward_claim`
- `qv_party_create`, `qv_party_join`

Resources:

- `qv://player/profile`
- `qv://modes/catalog`
- `qv://tournaments/active`
- `qv://tutorx/sessions`

Prompts:

- `quiz-coach`
- `study-plan-review`
- `post-quiz-debrief`

## Contract notes

`qv_quiz_fetch` is a routed union. Its six branches are recorded in
`QUIZ_FETCH_ROUTES`; the contract test derives from that manifest rather than
repeating a route count or list:

- `request` → `quizverse_request_questions` (`question-pack-v1`): exact
  `kind`, `mode`, `count`, `inline_questions`, with optional `scope`, `topic`,
  and `id_prefix`. This is the server seen-dedup/pack route and can report its
  downstream AI generator in `source_trace`; the separate web
  `quizverse_ai_generate_questions` fallback is not exposed as a seventh MCP
  route.
- `weekly` → `quizverse_weekly_fetch` (`iso-weekly-v1`): exact `type`,
  `lang_code`, `iso_year`, `iso_week`, `iso_day`; `{raw_json}` is parsed and
  normalized with web parity. Root arrays and `questions`/`items`/`data`/
  `results` wrappers are supported, along with the shipped prompt, option,
  answer-index/value, media, explanation, category, and difficulty aliases.
  Malformed entries are dropped and the response fails if none are answerable.
- `external` → `quizverse_fetch_external_quiz`
  (`external-provider-v1`): exact provider enum with provider-specific raw
  adapters for Jikan, PokeAPI, TheMealDB, Ghibli, countries, Disney, NASA,
  Star Wars, Dog CEO, and TheSportsDB.
  Star Wars uses its dedicated character eye-colour adapter: each prompt names
  the character, options contain one correct colour plus three distinct sibling
  colours, and `correctIndex` is derived after deterministic option ordering.
- `news` → `quizverse_fetch_news_quiz` (`web-unity-news-v1`): `lang` is
  required and `country` is optional. Web sends `{lang}` while Unity sends
  both. The response is the Unity `{success,source,cached,articles}` DTO.
- `movies` → `quizverse_fetch_movies_quiz` (`unity-movies-v1`): exact
  `{country,lang}` and `{success,source,cached,movies}` DTO.
- `music` → `quizverse_fetch_music_quiz` (`unity-music-v1`): exact
  `{country}` and `{success,cached,country,artists}` DTO.

Every branch normalizes to `quiz-fetch-routed-v2`: `route`, canonical
`questions`, safe `rawMetadata`, and `provenance` containing RPC, request
version, adapter, and provider where applicable. Full upstream payloads are
never returned. Question-pack `meta` is the documented
`question-pack-meta-v1` extension boundary. Provider adapters deliberately
project only source-consumed fields; future upstream extension fields are
accepted only inside the documented `<provider>-raw-v1` boundary and are
discarded during projection.
- Result submission uses `question_pack_id`, `mode`, `duration_ms`, and answer
  records with `question_id`, `selected_index`, and `latency_ms`.
- Score sync uses `leaderboard_id`, fixed `game_id`, `device_id`, `mode`,
  `score`, `correct`, and `total`.
- Friends use `targetUserId` for invites and the existing
  `friendUserId`/`gameId`/`challengeData` challenge contract. Friend list state
  is the numeric Nakama state and supports `limit`/`cursor`.
- Async challenges use Unity's `quizModeType`, `quizModeName`, `shareCode`,
  `sessionId`, `correctAnswers`, `totalQuestions`, and `timeTaken` names.
- Tournament entry uses `slug` and `paid_via`; daily reward claim has no
  invented reward selector.
- Parties use `matchmaking_create_party`, `matchmaking_join_party`, and
  `matchmaking_get_status` with the Unity `gameId` contracts.

## Desktop setup

QuizVerse Desktop defaults to `<QuizVerse userData>/hermes-home`, provisions
this MCP before the Hermes backend starts, and copies six brand skills there.
Named desktop profiles live beneath that same isolated root. Status requires
effective config/path checks plus a real MCP initialize/tools-list probe and
the current guest/auth capability.
The IX Agency build does not ship the server or skills and does not register
the QuizVerse IPC broker.

Older preview builds used the shared default Hermes home. They are not copied
automatically because doing so could import IX credentials or admin MCPs. An
explicit `HERMES_HOME` that resolves to IX/default `~/.hermes` is refused;
migrate intentionally to a distinct QuizVerse path instead.

For direct protocol testing, set `QUIZVERSE_MCP_BROKER_SOCKET` to a fixture
broker and run:

```sh
node server.mjs
```

Production credentials must never be passed on the command line, through MCP
configuration, through renderer IPC, or in skill text.
