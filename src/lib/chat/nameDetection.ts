// Name detection heuristics for distinguishing PI names from organization names

// Top ~300 most common US first names (from Census data)
// Covers vast majority of researchers
const COMMON_FIRST_NAMES = new Set([
  // Male names
  'james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph',
  'thomas', 'charles', 'christopher', 'daniel', 'matthew', 'anthony', 'mark',
  'donald', 'steven', 'paul', 'andrew', 'joshua', 'kenneth', 'kevin', 'brian',
  'george', 'timothy', 'ronald', 'edward', 'jason', 'jeffrey', 'ryan', 'jacob',
  'gary', 'nicholas', 'eric', 'jonathan', 'stephen', 'larry', 'justin', 'scott',
  'brandon', 'benjamin', 'samuel', 'raymond', 'gregory', 'frank', 'alexander',
  'patrick', 'jack', 'dennis', 'jerry', 'tyler', 'aaron', 'jose', 'adam', 'nathan',
  'henry', 'douglas', 'zachary', 'peter', 'kyle', 'noah', 'ethan', 'jeremy',
  'walter', 'christian', 'keith', 'roger', 'terry', 'carl', 'sean', 'austin',
  'arthur', 'lawrence', 'jesse', 'dylan', 'bryan', 'joe', 'jordan', 'billy',
  'bruce', 'albert', 'willie', 'gabriel', 'logan', 'alan', 'juan', 'wayne',
  'elijah', 'randy', 'roy', 'vincent', 'ralph', 'eugene', 'russell', 'bobby',
  'mason', 'philip', 'louis', 'harry', 'howard', 'fred', 'johnny', 'jimmy',
  // Female names
  'mary', 'patricia', 'jennifer', 'linda', 'elizabeth', 'barbara', 'susan',
  'jessica', 'sarah', 'karen', 'lisa', 'nancy', 'betty', 'margaret', 'sandra',
  'ashley', 'kimberly', 'emily', 'donna', 'michelle', 'dorothy', 'carol',
  'amanda', 'melissa', 'deborah', 'stephanie', 'rebecca', 'sharon', 'laura',
  'cynthia', 'kathleen', 'amy', 'angela', 'shirley', 'anna', 'brenda', 'pamela',
  'emma', 'nicole', 'helen', 'samantha', 'katherine', 'christine', 'debra',
  'rachel', 'carolyn', 'janet', 'catherine', 'maria', 'heather', 'diane',
  'ruth', 'julie', 'olivia', 'joyce', 'virginia', 'victoria', 'kelly', 'lauren',
  'christina', 'joan', 'evelyn', 'judith', 'megan', 'andrea', 'cheryl', 'hannah',
  'jacqueline', 'martha', 'gloria', 'teresa', 'ann', 'sara', 'madison', 'frances',
  'kathryn', 'janice', 'jean', 'abigail', 'alice', 'judy', 'sophia', 'grace',
  'denise', 'amber', 'doris', 'marilyn', 'danielle', 'beverly', 'isabella',
  'theresa', 'diana', 'natalie', 'brittany', 'charlotte', 'marie', 'kayla',
  'alexis', 'lori', 'julia', 'jane', 'anne', 'claire', 'mia', 'ava', 'zoe',
  // International names common in research
  'wei', 'ming', 'jing', 'lei', 'chen', 'lin', 'hong', 'yan', 'yong', 'hui',
  'xiao', 'jun', 'chang', 'zhao', 'feng', 'qing', 'gang', 'li', 'yi', 'hai',
  'kumar', 'raj', 'amit', 'ravi', 'priya', 'sanjay', 'anand', 'rakesh',
  'ahmed', 'mohammad', 'ali', 'hassan', 'omar', 'yusuf', 'fatima', 'aisha',
  'hiroshi', 'takeshi', 'yuki', 'kenji', 'akiko', 'yoko', 'haruki', 'naoko',
  'pierre', 'jean', 'francois', 'marie', 'claude', 'philippe', 'jacques',
  'hans', 'klaus', 'andreas', 'stefan', 'wolfgang', 'ulrich', 'juergen',
  'carlos', 'miguel', 'jose', 'maria', 'ana', 'luis', 'juan', 'antonio',
  // Titles (these indicate person)
  'dr', 'prof', 'professor',
])

// Corporate suffixes that indicate an organization
const CORPORATE_SUFFIXES = [
  'inc', 'inc.', 'incorporated',
  'llc', 'l.l.c.',
  'corp', 'corp.', 'corporation',
  'ltd', 'ltd.', 'limited',
  'co', 'co.',
  'company',
  'lp', 'l.p.', 'llp', 'l.l.p.',
  'plc', 'p.l.c.',
  'gmbh', 'ag', 'sa', 'bv', 'nv',
]

// Institutional keywords that indicate an organization (not a person)
const INSTITUTIONAL_KEYWORDS = [
  'university', 'college', 'institute', 'institution',
  'hospital', 'medical center', 'clinic', 'health system',
  'foundation', 'association', 'society', 'consortium',
  'laboratory', 'laboratories', 'lab', 'labs',
  'center', 'centre',
  'research', 'sciences', 'scientific',
  'group', 'partners', 'services',
  'network', 'alliance', 'council',
  'department', 'division', 'school',
  // Biotech/pharma industry keywords
  'therapeutics', 'pharma', 'pharmaceutical', 'pharmaceuticals',
  'biosciences', 'bioscience', 'biotech', 'biotechnology', 'biotechnologies',
  'technologies', 'technology', 'tech',
  'genomics', 'proteomics', 'diagnostics',
  'oncology', 'neuroscience', 'immunology',
  'medical', 'medicine', 'health', 'healthcare',
]

export type NameType = 'pi' | 'org' | 'unknown'

export interface NameDetectionResult {
  type: NameType
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

export function detectNameType(input: string): NameDetectionResult {
  const normalized = input.trim().toLowerCase()
  const words = normalized.split(/\s+/)

  // Rule 1: Check for corporate suffixes (high confidence org)
  for (const suffix of CORPORATE_SUFFIXES) {
    if (normalized.endsWith(` ${suffix}`) || normalized === suffix) {
      return { type: 'org', confidence: 'high', reason: `Corporate suffix: ${suffix}` }
    }
  }

  // Rule 2: Check for institutional keywords (high confidence org)
  for (const keyword of INSTITUTIONAL_KEYWORDS) {
    if (normalized.includes(keyword)) {
      return { type: 'org', confidence: 'high', reason: `Institutional keyword: ${keyword}` }
    }
  }

  // Rule 3: Check for "X company" pattern (high confidence org)
  if (normalized.endsWith(' company') || normalized.includes(' company ')) {
    return { type: 'org', confidence: 'high', reason: '"X company" pattern' }
  }

  // Rule 4: Check for title prefix (high confidence person)
  if (words[0] === 'dr' || words[0] === 'dr.' || words[0] === 'prof' || words[0] === 'professor') {
    return { type: 'pi', confidence: 'high', reason: 'Title prefix indicates person' }
  }

  // Rule 5: Check for comma format "Last, First" (medium confidence person)
  if (input.includes(',') && words.length >= 2) {
    const [lastName, ...rest] = input.split(',')
    const firstName = rest.join(',').trim().split(/\s+/)[0]?.toLowerCase()
    if (firstName && COMMON_FIRST_NAMES.has(firstName)) {
      return { type: 'pi', confidence: 'medium', reason: 'Comma format with common first name' }
    }
  }

  // Rule 6: Check if first word is a common first name (medium confidence person)
  // Only if we have 2-4 words (typical name length)
  if (words.length >= 2 && words.length <= 4) {
    const firstWord = words[0].replace(/[.,]/g, '')
    if (COMMON_FIRST_NAMES.has(firstWord)) {
      // If first word is a common first name, assume it's a person
      // (users often type names in lowercase)
      return { type: 'pi', confidence: 'medium', reason: 'Common first name pattern' }
    }
  }

  // Rule 7: Single word - could be either, default to org
  if (words.length === 1) {
    return { type: 'org', confidence: 'low', reason: 'Single word - defaulting to organization' }
  }

  // Rule 8: Default for ambiguous cases - assume org (safer default)
  return { type: 'org', confidence: 'low', reason: 'No clear indicators - defaulting to organization' }
}
