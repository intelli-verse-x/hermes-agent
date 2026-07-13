# QuizVerse Words content delivery

Full General and GRE dictionaries and puzzle banks are not bundled in this
repository. They remain server-distributed first-party content.

Desktop fetches `GET https://quizverse.world/api/words/content/manifest`. The
versioned manifest contract is implemented in `engines/words-content.ts` and
contains, for every dataset:

- stable dataset ID, kind, and skin;
- first-party `/api/words/content/<id>` URL;
- exact byte length and SHA-256 digest;
- minimum item count, content version, and optional ETag.

The main process performs conditional ETag requests and stores successful
responses in the active Hermes profile under `cache/quizverse/words/`. Cache
payloads are encrypted with Electron `safeStorage`; plaintext content and
credentials never enter the cache. Invalid envelopes are deleted, integrity
or count mismatches are rejected, and an offline request can use only a
previously verified encrypted response.

The small arrays in `native-game-content.ts` are original fallback content.
They exist only so setup, offline, and corruption-recovery states remain
playable. They are not a replacement for the full server banks.

Production infrastructure must publish the manifest endpoint and all datasets.
Until it does, Desktop reports first-party content setup failures and uses the
approved minimal fallback.
