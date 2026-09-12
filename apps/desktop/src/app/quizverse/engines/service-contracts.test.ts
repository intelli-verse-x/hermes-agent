import { describe, expect, it, vi } from 'vitest'

import {
  audiobookLibraryPath,
  audiobookPositionPayload,
  certificateIdFromClaim,
  debateScorePayload,
  loadTournamentPackArtifact,
  normalizeLearningTrack,
  normalizeTournamentBracket,
  normalizeTournamentCertificate
} from './service-contracts'

describe('QuizVerse repository service contracts', () => {
  it('builds the Link & Play debate and audiobook requests', () => {
    expect(debateScorePayload('School uniforms', 'against')).toEqual({
      topic: 'School uniforms',
      userPosition: 'against'
    })
    expect(audiobookLibraryPath('user/id')).toBe('/audiobook/library/user%2Fid')
    expect(audiobookPositionPayload(12.345)).toEqual({ positionMs: 12_345 })
  })

  it('normalizes the published bracket metadata without inventing rounds', () => {
    expect(
      normalizeTournamentBracket({
        data: {
          bracket_id: 'br_1',
          exists: true,
          public_dashboard_url: 'https://bracket.intelli-verse-x.ai/tournament/br_1',
          round: 2,
          total_rounds: 6
        }
      })
    ).toEqual({
      bracketId: 'br_1',
      exists: true,
      publicDashboardUrl: 'https://bracket.intelli-verse-x.ai/tournament/br_1',
      round: 2,
      totalRounds: 6
    })
    expect(() =>
      normalizeTournamentBracket({
        data: {
          bracket_id: 'br_1',
          exists: true,
          public_dashboard_url: 'https://evil.example/br_1',
          round: 1,
          total_rounds: 2
        }
      })
    ).toThrow(/untrusted/)
  })

  it('uses the certificate claim id for the certificate lookup envelope', () => {
    expect(certificateIdFromClaim({ data: { certificate_id: 'cert_1' } })).toBe('cert_1')
    expect(
      normalizeTournamentCertificate({
        data: { certificate: { id: 'cert_1', player_username: 'Ada', tournament_name: 'Cup' } }
      })
    ).toMatchObject({ id: 'cert_1', player_username: 'Ada' })
  })

  it('parses videos from data.track and fetches the signed pack artifact', async () => {
    expect(
      normalizeLearningTrack({
        data: { track: { track_id: 'track-1', topic_tag: 'math', videos: [{ id: 'v1', title: 'Algebra' }] } }
      }).videos
    ).toEqual([{ id: 'v1', title: 'Algebra' }])

    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            questions: [{ id: 'q1', prompt: '2+2?', options: ['3', '4'], correctIndex: 1 }]
          }),
          { status: 200 }
        )
    )

    const pack = await loadTournamentPackArtifact(
      {
        data: {
          pack: {
            content_factory_task_id: 'task-1',
            s3_url: 'https://quizverse-packs.s3.amazonaws.com/task-1.json'
          }
        }
      },
      'cup',
      fetcher
    )

    expect(pack).toMatchObject({ packId: 'task-1', status: 'ready' })
    expect(pack.questions[0]).toMatchObject({ correctIndex: 1, id: 'q1' })
  })
})
