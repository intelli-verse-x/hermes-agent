import { fnv1a32, seededShuffle, utcDay } from './daily-content'

export type LetterScore = 'absent' | 'correct' | 'present'

export interface WordGroup {
  tier: 'easy' | 'hard' | 'medium' | 'tricky'
  title: string
  words: readonly string[]
}

export interface SpellPuzzle {
  center: string
  id: string
  letters: readonly string[]
  pangram: string
  words: readonly string[]
}

export interface CrosswordClue {
  answer: string
  clue: string
  col: number
  len: number
  n: number
  row: number
}

export interface CrosswordPuzzle {
  clues: { across: readonly CrosswordClue[]; down: readonly CrosswordClue[] }
  difficulty: string
  grid: readonly (readonly string[])[]
  id: string
  theme: string
}

export interface ImposterPuzzle {
  a: string
  b: string
  category: string
}

export const DAILY_WORDS =
  'about above abuse actor adapt admit adopt adult after again agent agree ahead alarm album alert alike alive allow alone along alter amber amend among angel anger angle angry ankle apart apple apply arena argue arise armor array aside asset audio audit avoid award aware awful badge baker basic basin basis batch beach began begin begun being below bench berry birth black blame blank blast blaze bleak blend bless blind block blood bloom blown blunt board boost booth bound brain brake brand brave bread break breed brick brief bring brisk broad broke brown brush build built buyer cabin cable candy carry catch cause chain chair chalk champ chaos charm chart cheap check cheer chess chief child chill chunk civic claim clamp clash class clean clear clerk click cliff climb clock close cloth cloud clown coach coast color comic could count court cover crack craft crane crash crate crawl crazy cream creek crest crime crisp cross crowd crown crude crumb crush crust daily dance death depth doubt dream drink drive earth eight elite empty enjoy entry event every exact exist extra faith false fault favor feast field fifty fight final first flame flash fleet flesh float floor focus force found frame fresh front fruit funny giant given glass globe glory grace grade grain grand grant grape graph grass great green greet group grown guard guest guide habit happy heart heavy hence hobby honey horse house human ideal image imply index inner input issue ivory judge known label large laser later laugh layer learn least leave legal lemon level light limit local logic lucky lunch magic major maker march match maybe medal media mercy metal might minor model money month moral motor mount mouse movie music never night noise north novel nurse ocean offer often order other ought paint panel paper party peace phase phone photo piece pilot pitch place plain plane plant plate point pound power press price pride prime print proof proud queen quick quiet radio raise range rapid reach react ready realm right river robot rough round route royal scale scene scope score sense serve shape share sharp sheet shelf shell shift shine shirt shock short skill sleep small smart smile solid solve sound south space speak speed spell spent spice split sport staff stage stair stake stand start state steam steel steep stick still stock stone store study style sugar sweet table taste teach theme there thick thing think third title today topic total touch tower track trade train treat trend trial trust truth uncle under union unity until upper upset urban usage valid value value video visit vital voice waste watch water wheel where which white whole woman world worry worth would write wrong young youth'.split(
    ' '
  )

export const WORD_GROUP_PUZZLES: readonly (readonly WordGroup[])[] = [
  [
    { tier: 'easy', title: 'Big Cats', words: ['LION', 'TIGER', 'LEOPARD', 'JAGUAR'] },
    { tier: 'medium', title: 'Card Games', words: ['BRIDGE', 'RUMMY', 'POKER', 'HEARTS'] },
    { tier: 'hard', title: 'Famous ___-stones', words: ['BRIM', 'LIME', 'MILE', 'CAP'] },
    { tier: 'tricky', title: '___ ball', words: ['BASKET', 'FOOT', 'BASE', 'VOLLEY'] }
  ],
  [
    { tier: 'easy', title: 'Citrus Fruits', words: ['LEMON', 'LIME', 'ORANGE', 'GRAPEFRUIT'] },
    { tier: 'medium', title: 'Things That Run', words: ['NOSE', 'RIVER', 'ENGINE', 'MASCARA'] },
    { tier: 'hard', title: 'Words After "Sun"', words: ['SHINE', 'RISE', 'SET', 'BEAM'] },
    { tier: 'tricky', title: 'Hidden Animals', words: ['CARPET', 'TRACK', 'EVENT', 'CATALOG'] }
  ],
  [
    { tier: 'easy', title: 'Planets', words: ['MARS', 'VENUS', 'JUPITER', 'SATURN'] },
    { tier: 'medium', title: 'Coffee Drinks', words: ['LATTE', 'MOCHA', 'BREVE', 'MACCHIATO'] },
    { tier: 'hard', title: 'Chess Pieces', words: ['ROOK', 'BISHOP', 'KNIGHT', 'PAWN'] },
    { tier: 'tricky', title: 'Words for "Said"', words: ['UTTERED', 'REMARKED', 'DECLARED', 'VOICED'] }
  ]
]

export const SPELL_PUZZLES: readonly SpellPuzzle[] = [
  {
    id: 'gen-spell-01',
    center: 'T',
    letters: ['T', 'A', 'I', 'L', 'C', 'P', 'O'],
    words: ['TACO', 'TAIL', 'PACT', 'LAIT', 'PATIO', 'PILOT', 'LOOT', 'TOOT', 'TOPIC', 'OPTIC', 'CAPITOL', 'COITAL'],
    pangram: 'CAPITOL'
  },
  {
    id: 'gen-spell-02',
    center: 'R',
    letters: ['R', 'E', 'A', 'D', 'G', 'N', 'I'],
    words: [
      'DARE',
      'DEAR',
      'RAIN',
      'RIDE',
      'RAID',
      'GRADE',
      'GRAIN',
      'GRIND',
      'RANGE',
      'READING',
      'DRAINER',
      'GARDENING'
    ],
    pangram: 'GARDENING'
  },
  {
    id: 'gen-spell-03',
    center: 'O',
    letters: ['O', 'C', 'M', 'P', 'S', 'E', 'T'],
    words: [
      'COME',
      'COPE',
      'COST',
      'POEM',
      'POET',
      'SCOPE',
      'COMET',
      'SMOTE',
      'TEMPO',
      'COMPOSE',
      'COMPOST',
      'COMPETE',
      'COMPOTES'
    ],
    pangram: 'COMPOTES'
  },
  {
    id: 'gen-spell-04',
    center: 'N',
    letters: ['N', 'I', 'G', 'H', 'T', 'L', 'E'],
    words: ['NINE', 'NIGHT', 'HINGE', 'LINEN', 'TENT', 'THINE', 'LIGHTEN', 'LENGTHEN', 'ENLIGHTEN', 'LINING', 'TILING'],
    pangram: 'ENLIGHTEN'
  }
]

export const CROSSWORD_PUZZLES: readonly CrosswordPuzzle[] = [
  {
    id: 'gen-cw-01',
    theme: 'Rules',
    difficulty: 'easy',
    grid: [
      ['T', 'A', 'B', 'O', 'O'],
      ['.', '.', 'A', '.', '.'],
      ['B', 'A', 'S', 'I', 'S'],
      ['.', '.', 'I', '.', '.'],
      ['F', 'A', 'C', 'E', 'T']
    ],
    clues: {
      across: [
        { n: 1, row: 0, col: 0, len: 5, clue: 'Forbidden topic.', answer: 'TABOO' },
        { n: 3, row: 2, col: 0, len: 5, clue: 'Foundation; core principle.', answer: 'BASIS' },
        { n: 4, row: 4, col: 0, len: 5, clue: 'Polished surface; aspect.', answer: 'FACET' }
      ],
      down: [{ n: 2, row: 0, col: 2, len: 5, clue: 'Elementary; fundamental.', answer: 'BASIC' }]
    }
  },
  {
    id: 'gen-cw-02',
    theme: 'Music & Clocks',
    difficulty: 'easy',
    grid: [
      ['W', 'A', 'T', 'C', 'H'],
      ['.', '.', 'E', '.', '.'],
      ['L', 'E', 'M', 'O', 'N'],
      ['.', '.', 'P', '.', '.'],
      ['P', 'R', 'O', 'O', 'F']
    ],
    clues: {
      across: [
        { n: 1, row: 0, col: 0, len: 5, clue: 'Wrist timepiece; observe closely.', answer: 'WATCH' },
        { n: 3, row: 2, col: 0, len: 5, clue: 'Yellow citrus fruit.', answer: 'LEMON' },
        { n: 4, row: 4, col: 0, len: 5, clue: 'Conclusive evidence.', answer: 'PROOF' }
      ],
      down: [{ n: 2, row: 0, col: 2, len: 5, clue: 'Speed of music.', answer: 'TEMPO' }]
    }
  }
]

export const IMPOSTER_PUZZLES: readonly ImposterPuzzle[] = [
  { category: 'Movies', a: 'TITANIC', b: 'AVATAR' },
  { category: 'Sports', a: 'CRICKET', b: 'BASEBALL' },
  { category: 'Tech', a: 'IPHONE', b: 'ANDROID' },
  { category: 'Food', a: 'PIZZA', b: 'BURGER' },
  { category: 'Animals', a: 'TIGER', b: 'LION' },
  { category: 'Cities', a: 'LONDON', b: 'PARIS' },
  { category: 'Exams', a: 'GRE', b: 'GMAT' },
  { category: 'Games', a: 'CHESS', b: 'CHECKERS' }
]

export function scoreWord(target: string, guess: string): LetterScore[] {
  const result: LetterScore[] = Array.from({ length: target.length }, () => 'absent')
  const remaining = new Map<string, number>()

  for (let index = 0; index < target.length; index += 1) {
    if (guess[index] === target[index]) {
      result[index] = 'correct'
    } else {
      remaining.set(target[index]!, (remaining.get(target[index]!) ?? 0) + 1)
    }
  }

  for (let index = 0; index < guess.length; index += 1) {
    if (result[index] === 'correct') {
      continue
    }
    const count = remaining.get(guess[index]!) ?? 0

    if (count > 0) {
      result[index] = 'present'
      remaining.set(guess[index]!, count - 1)
    }
  }

  return result
}

export function wordShareGrid(target: string, guesses: readonly string[]): string {
  const icons: Record<LetterScore, string> = { absent: '⬛', correct: '🟩', present: '🟨' }

  return guesses
    .map(guess =>
      scoreWord(target, guess)
        .map(score => icons[score])
        .join('')
    )
    .join('\n')
}

export function crosswordCleanSolveEligible(solved: boolean, revealed: boolean): boolean {
  return solved && !revealed
}

export function spellScore(words: readonly string[], puzzle: SpellPuzzle): number {
  return words.reduce(
    (score, word) => score + (word.length === 4 ? 1 : word.length) + (isPangram(word, puzzle) ? 7 : 0),
    0
  )
}

export function isPangram(word: string, puzzle: SpellPuzzle): boolean {
  const normalized = word.toUpperCase()

  return puzzle.letters.every(letter => normalized.includes(letter))
}

export function validateSpellWord(word: string, puzzle: SpellPuzzle): string | null {
  const normalized = word.trim().toUpperCase()

  if (normalized.length < 4) {
    return 'Words must contain at least four letters.'
  }

  if (!normalized.includes(puzzle.center)) {
    return `Words must use ${puzzle.center}.`
  }

  if ([...normalized].some(letter => !puzzle.letters.includes(letter))) {
    return 'That word uses a letter outside the hive.'
  }

  if (!puzzle.words.includes(normalized) && normalized !== puzzle.pangram) {
    return 'That word is not in today’s source list.'
  }

  return null
}

export function imposterIndices(players: number, count: number, seed: number): number[] {
  return seededShuffle(
    Array.from({ length: players }, (_, index) => index),
    seed
  )
    .slice(0, count)
    .sort((a, b) => a - b)
}

export function imposterResult(votes: Readonly<Record<number, number>>, imposters: readonly number[]) {
  const tally = new Map<number, number>()
  Object.values(votes).forEach(vote => tally.set(vote, (tally.get(vote) ?? 0) + 1))
  const maximum = Math.max(0, ...tally.values())
  const leaders = [...tally.entries()].filter(([, value]) => value === maximum).map(([index]) => index)
  const ejected = leaders.length === 1 ? leaders[0]! : null
  const caught = ejected !== null && imposters.includes(ejected)

  return { caught, ejected, imposterWin: !caught, tied: leaders.length !== 1 }
}

export interface VoyageTheme {
  icons: readonly string[]
  name: string
  pictures: readonly { emoji: string; label: string }[]
  trivia: readonly { correctIndex: number; options: readonly string[]; prompt: string }[]
  wordTargets: readonly string[]
  words: readonly string[]
}

type TriviaTuple = readonly [string, readonly string[], number]

function theme(
  name: string,
  icons: readonly string[],
  wordTargets: readonly string[],
  words: readonly string[],
  pictures: readonly { emoji: string; label: string }[],
  trivia: readonly TriviaTuple[]
): VoyageTheme {
  return {
    icons,
    name,
    pictures,
    trivia: trivia.map(([prompt, options, correctIndex]) => ({ correctIndex, options, prompt })),
    wordTargets,
    words
  }
}

export const VOYAGE_THEMES: readonly VoyageTheme[] = [
  theme(
    'space',
    ['🪐', '🚀', '🌕', '☄️', '🛸', '⭐', '🌌', '🌠'],
    ['SATURN', 'SUN', 'STAR', 'MARS'],
    ['MARS', 'MOON', 'STAR', 'COMET', 'ORBIT', 'SUN'],
    [
      { emoji: '🪐', label: 'Saturn' },
      { emoji: '🚀', label: 'Rocket' },
      { emoji: '🌕', label: 'Moon' },
      { emoji: '☄️', label: 'Comet' }
    ],
    [
      ['Which planet is known as the Red Planet?', ['Venus', 'Mars', 'Jupiter', 'Saturn'], 1],
      ['How many moons does Earth have?', ['0', '1', '2', '3'], 1],
      ['What is the largest planet in our solar system?', ['Earth', 'Saturn', 'Jupiter', 'Neptune'], 2],
      ['The Sun is what type of star?', ['Red giant', 'White dwarf', 'Yellow dwarf', 'Blue giant'], 2],
      ['Which planet has the most prominent rings?', ['Jupiter', 'Saturn', 'Uranus', 'Neptune'], 1],
      ['What galaxy is Earth in?', ['Andromeda', 'Triangulum', 'Milky Way', 'Whirlpool'], 2],
      [
        'Who was the first person to walk on the Moon?',
        ['Buzz Aldrin', 'Yuri Gagarin', 'Neil Armstrong', 'John Glenn'],
        2
      ],
      ['How long does sunlight take to reach Earth?', ['1 second', '8 minutes', '1 hour', '1 day'], 1],
      ['What is a light-year a measure of?', ['Time', 'Distance', 'Brightness', 'Mass'], 1],
      [
        'Which is the closest star to Earth (besides the Sun)?',
        ['Sirius', 'Alpha Centauri', 'Proxima Centauri', 'Vega'],
        2
      ],
      ['Pluto was reclassified as what in 2006?', ['Asteroid', 'Comet', 'Dwarf planet', 'Moon'], 2],
      ['What force keeps planets in orbit?', ['Magnetism', 'Gravity', 'Friction', 'Tension'], 1]
    ]
  ),
  theme(
    'animals',
    ['🐶', '🐱', '🦁', '🐘', '🦒', '🐧', '🦋', '🐠'],
    ['PANTHER', 'HARE', 'RAT', 'HEN'],
    ['LION', 'BEAR', 'WOLF', 'TIGER', 'SHARK', 'BEE'],
    [
      { emoji: '🦁', label: 'Lion' },
      { emoji: '🐘', label: 'Elephant' },
      { emoji: '🦒', label: 'Giraffe' },
      { emoji: '🐧', label: 'Penguin' }
    ],
    [
      ['Which animal is the largest mammal?', ['Elephant', 'Blue whale', 'Giraffe', 'Polar bear'], 1],
      ['How many hearts does an octopus have?', ['1', '2', '3', '4'], 2],
      ['A group of lions is called a what?', ['Pack', 'Pride', 'Herd', 'Flock'], 1],
      ['Which bird is known for its colorful tail and dance?', ['Pigeon', 'Peacock', 'Penguin', 'Parrot'], 1],
      ['Cheetahs can sprint up to roughly what speed?', ['40 mph', '60 mph', '75 mph', '100 mph'], 2],
      [
        'Which animal is a primate that uses sign language in famous studies?',
        ['Dolphin', 'Gorilla', 'Parrot', 'Dog'],
        1
      ],
      ['A baby kangaroo is called a what?', ['Pup', 'Joey', 'Cub', 'Calf'], 1],
      ['Which animal sleeps standing up most of the time?', ['Cow', 'Horse', 'Sheep', 'Goat'], 1],
      ['Honey bees communicate via what?', ['Songs', 'Dance', 'Pheromones only', 'Tail flicks'], 1],
      ['Which is the only mammal that can truly fly?', ['Flying squirrel', 'Bat', 'Sugar glider', 'Colugo'], 1],
      ['Polar bears have what color of skin under their fur?', ['White', 'Pink', 'Black', 'Brown'], 2],
      ['How many legs does a spider have?', ['6', '7', '8', '10'], 2]
    ]
  ),
  theme(
    'world',
    ['🌍', '🗽', '🗼', '🏔️', '🏝️', '🕌', '🌋', '🏯'],
    ['ISLAND', 'LAND', 'SAND', 'LANE'],
    ['NILE', 'PARIS', 'TOKYO', 'OCEAN', 'RIVER', 'ASIA'],
    [
      { emoji: '🗼', label: 'Paris' },
      { emoji: '🗽', label: 'New York' },
      { emoji: '🏔️', label: 'Everest' },
      { emoji: '🌋', label: 'Volcano' }
    ],
    [
      ['Which is the longest river in the world?', ['Amazon', 'Nile', 'Yangtze', 'Mississippi'], 1],
      ['Mount Everest is on the border of Nepal and which country?', ['India', 'Bhutan', 'China', 'Pakistan'], 2],
      ['Which country has the most population (2024 est.)?', ['USA', 'China', 'India', 'Indonesia'], 2],
      ['The Sahara desert is on which continent?', ['Asia', 'Africa', 'South America', 'Australia'], 1],
      ['What is the capital of Australia?', ['Sydney', 'Melbourne', 'Canberra', 'Brisbane'], 2],
      ['The Amazon rainforest is mostly in which country?', ['Peru', 'Colombia', 'Brazil', 'Venezuela'], 2],
      ['Which ocean is the largest?', ['Atlantic', 'Indian', 'Pacific', 'Arctic'], 2],
      ['Mount Kilimanjaro is in which country?', ['Kenya', 'Uganda', 'Tanzania', 'Ethiopia'], 2],
      ['Which European country uses the koruna as currency?', ['Czech Republic', 'Hungary', 'Poland', 'Sweden'], 0],
      [
        'The Great Barrier Reef is off the coast of which country?',
        ['Indonesia', 'Philippines', 'Australia', 'Fiji'],
        2
      ],
      ['Which city is known as the City of Lights?', ['London', 'Paris', 'Vienna', 'Rome'], 1],
      ['The Andes mountain range runs through which continent?', ['Asia', 'Africa', 'South America', 'Europe'], 2]
    ]
  ),
  theme(
    'science',
    ['🧪', '⚗️', '🔬', '🧬', '⚛️', '💡', '🧫', '🌡️'],
    ['REACTOR', 'REACT', 'CORE', 'TRACE'],
    ['ATOM', 'CELL', 'GENE', 'LIGHT', 'WATER', 'HEAT'],
    [
      { emoji: '🧪', label: 'Lab' },
      { emoji: '🧬', label: 'DNA' },
      { emoji: '⚛️', label: 'Atom' },
      { emoji: '🌡️', label: 'Thermometer' }
    ],
    [
      ['What is the chemical symbol for gold?', ['Go', 'Gd', 'Au', 'Ag'], 2],
      ['Water boils (at sea level) at what temperature in Celsius?', ['90', '95', '100', '105'], 2],
      ['How many bones are in the adult human body?', ['186', '206', '226', '246'], 1],
      ['What gas do plants absorb from the air?', ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'], 2],
      ['What is the smallest unit of matter?', ['Cell', 'Molecule', 'Atom', 'Proton'], 2],
      [
        'DNA stands for what?',
        ['Deoxyribonucleic acid', 'Dynamic nucleic action', 'Diribose nuclear acid', 'Direct nucleotide assembly'],
        0
      ],
      ['Sound travels fastest through which medium?', ['Air', 'Water', 'Steel', 'Vacuum'], 2],
      ['Which scientist developed the theory of relativity?', ['Newton', 'Tesla', 'Einstein', 'Curie'], 2],
      ['Lightning is essentially a giant what?', ['Magnet', 'Spark', 'Whirlwind', 'Sound wave'], 1],
      ['What is the powerhouse of the cell?', ['Nucleus', 'Ribosome', 'Mitochondria', 'Vacuole'], 2],
      ['pH 7 is considered what?', ['Acidic', 'Neutral', 'Basic', 'Saline'], 1],
      ['Which planet has the strongest gravity in our solar system?', ['Earth', 'Saturn', 'Jupiter', 'Neptune'], 2]
    ]
  ),
  theme(
    'history',
    ['🏛️', '📜', '⚔️', '🏺', '🗿', '🏰', '👑', '🛡️'],
    ['EMPIRE', 'PRIME', 'RIPE', 'PIER'],
    ['ROME', 'EGYPT', 'KING', 'EMPIRE', 'PYRAMID', 'WAR'],
    [
      { emoji: '🏛️', label: 'Greek Temple' },
      { emoji: '🗿', label: 'Easter Island' },
      { emoji: '🏰', label: 'Castle' },
      { emoji: '👑', label: 'Crown' }
    ],
    [
      ['In what year did World War II end?', ['1943', '1945', '1947', '1950'], 1],
      ['Who was the first US president?', ['Jefferson', 'Washington', 'Adams', 'Lincoln'], 1],
      ['The Great Wall is in which country?', ['Japan', 'India', 'China', 'Mongolia'], 2],
      ['Who painted the Mona Lisa?', ['Michelangelo', 'Raphael', 'Da Vinci', 'Donatello'], 2],
      ['The Roman Empire fell in approximately what year?', ['476 AD', '1066 AD', '1492 AD', '1776 AD'], 0],
      ['Which civilization built Machu Picchu?', ['Maya', 'Aztec', 'Inca', 'Olmec'], 2],
      ['Cleopatra ruled which ancient kingdom?', ['Persia', 'Egypt', 'Greece', 'Rome'], 1],
      ['In what year did humans first land on the Moon?', ['1965', '1967', '1969', '1972'], 2],
      ['The Berlin Wall fell in what year?', ['1985', '1987', '1989', '1991'], 2],
      ['Who wrote the original "Romeo and Juliet"?', ['Marlowe', 'Shakespeare', 'Chaucer', 'Milton'], 1],
      ['The Pyramids of Giza are in which country?', ['Sudan', 'Egypt', 'Libya', 'Iraq'], 1],
      ['Which empire was ruled by Genghis Khan?', ['Ottoman', 'Mongol', 'Roman', 'Persian'], 1]
    ]
  ),
  theme(
    'tech',
    ['💻', '📱', '🤖', '🛰️', '💾', '🖥️', '🔌', '📡'],
    ['POINTER', 'POINT', 'PRINT', 'PORT'],
    ['CODE', 'BYTE', 'PIXEL', 'CLOUD', 'APP', 'WEB'],
    [
      { emoji: '💻', label: 'Laptop' },
      { emoji: '🤖', label: 'Robot' },
      { emoji: '🛰️', label: 'Satellite' },
      { emoji: '📱', label: 'Phone' }
    ],
    [
      ['Who founded Microsoft?', ['Steve Jobs', 'Bill Gates', 'Elon Musk', 'Mark Zuckerberg'], 1],
      [
        'What does CPU stand for?',
        ['Computer Personal Unit', 'Central Processing Unit', 'Core Power Utility', 'Common Program Use'],
        1
      ],
      ['Which company makes the iPhone?', ['Samsung', 'Sony', 'Apple', 'LG'], 2],
      [
        'HTML stands for what?',
        [
          'Hyper Text Markup Language',
          'High Tech Modern Language',
          'Home Tool Modular Library',
          'Hyperlink Tagging Markup'
        ],
        0
      ],
      ['JavaScript was created in approximately what year?', ['1985', '1995', '2005', '2015'], 1],
      ['Which company owns Android?', ['Apple', 'Microsoft', 'Google', 'Meta'], 2],
      ['A "byte" is composed of how many bits?', ['4', '8', '16', '32'], 1],
      ['Wi-Fi is short for what?', ['Wireless Fidelity', 'Wireless Field', 'Wide Frequency', 'Wireless Function'], 0],
      [
        'Bitcoin’s creator goes by what pseudonym?',
        ['Vitalik Buterin', 'Satoshi Nakamoto', 'John McAfee', 'Hal Finney'],
        1
      ],
      [
        'GPU stands for what?',
        ['General Purpose Unit', 'Graphics Processing Unit', 'Game Power Utility', 'Graphical Pixel User'],
        1
      ],
      ['Which programming language is most associated with web browsers?', ['Python', 'Java', 'JavaScript', 'Ruby'], 2],
      [
        'The cloud is essentially what?',
        ['Local storage', 'Someone else’s computer', 'A type of network cable', 'Mobile data only'],
        1
      ]
    ]
  )
]

export function voyageSeed(game: string, date = new Date()): number {
  return fnv1a32(`voyage:${game}:${utcDay(date)}`)
}

export function voyageTheme(date = new Date()): VoyageTheme {
  const epoch = Date.UTC(2026, 4, 25)
  const dayIndex = Math.max(0, Math.floor((date.getTime() - epoch) / 86_400_000))

  return VOYAGE_THEMES[dayIndex % VOYAGE_THEMES.length]!
}

export interface WordPlacement {
  cells: readonly (readonly [number, number])[]
  word: string
}

export function buildWordSearch(
  words: readonly string[],
  seed: number,
  size = 10
): {
  grid: string[][]
  placements: WordPlacement[]
} {
  const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => ''))
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [-1, 1],
    [0, -1],
    [-1, 0],
    [-1, -1],
    [1, -1]
  ] as const
  let state = seed >>> 0

  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0

    return state / 0x1_0000_0000
  }

  const placements: WordPlacement[] = []

  for (const rawWord of words) {
    const word = rawWord.toUpperCase()

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [dr, dc] = directions[Math.floor(random() * directions.length)]!
      const startRow = Math.floor(random() * size)
      const startColumn = Math.floor(random() * size)
      const cells = [...word].map((_, index) => [startRow + dr * index, startColumn + dc * index] as const)

      if (
        cells.some(
          ([row, column], index) =>
            row < 0 ||
            column < 0 ||
            row >= size ||
            column >= size ||
            (grid[row]![column] !== '' && grid[row]![column] !== word[index])
        )
      ) {
        continue
      }

      cells.forEach(([row, column], index) => {
        grid[row]![column] = word[index]!
      })
      placements.push({ cells, word })

      break
    }
  }

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  grid.forEach(row =>
    row.forEach((letter, column) => {
      if (!letter) {
        row[column] = alphabet[Math.floor(random() * alphabet.length)]!
      }
    })
  )

  return { grid, placements }
}
