import path from 'node:path'

export function assertQuizverseIsolatedHome(candidate: string, ixDefault: string): string {
  const resolved = path.resolve(candidate)

  if (resolved === path.resolve(ixDefault)) {
    throw new Error(
      'QuizVerse refuses the shared IX/default HERMES_HOME. Unset HERMES_HOME or migrate to a dedicated QuizVerse path.'
    )
  }

  return resolved
}

export function resolveQuizverseEffectiveHermesHome(
  baseHome: string,
  activeProfile: string | null
): string {
  return activeProfile && activeProfile !== 'default'
    ? path.join(baseHome, 'profiles', activeProfile)
    : baseHome
}
