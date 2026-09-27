// Smart search over what Vision saw in each photo ("beach", "dog", "food"),
// plus dates, cameras, file / folder names, and a few special words.
// Everything runs locally on the index; nothing leaves the Mac.

import type { MediaItem } from '@shared/types'
import { all } from './db'
import { ITEM_COLUMNS, VISIBLE, toItem, type ItemRow } from './media'

/** Everyday words → Vision label identifiers (Apple's taxonomy uses snake_case). */
const SYNONYMS: Record<string, string[]> = {
  beach: ['beach', 'shore', 'sand', 'seashore'],
  sea: ['ocean', 'sea', 'water_body', 'waves'],
  ocean: ['ocean', 'sea', 'waves'],
  sunset: ['sunset_sunrise', 'sunset', 'sunrise', 'dusk'],
  sunrise: ['sunset_sunrise', 'sunrise'],
  mountain: ['mountain', 'hill', 'cliff', 'peak'],
  mountains: ['mountain', 'hill', 'cliff', 'peak'],
  snow: ['snow', 'winter', 'ice', 'ski'],
  food: ['food', 'meal', 'dish', 'dessert', 'fruit', 'vegetable', 'baked_goods', 'breakfast', 'dinner', 'lunch'],
  dog: ['dog', 'canine', 'puppy'],
  dogs: ['dog', 'canine', 'puppy'],
  cat: ['cat', 'feline', 'kitten'],
  cats: ['cat', 'feline', 'kitten'],
  car: ['car', 'automobile', 'vehicle', 'sports_car'],
  cars: ['car', 'automobile', 'vehicle'],
  city: ['cityscape', 'skyscraper', 'building', 'street', 'urban'],
  flower: ['flower', 'blossom', 'bouquet', 'rose', 'tulip'],
  flowers: ['flower', 'blossom', 'bouquet'],
  tree: ['tree', 'forest', 'woodland'],
  forest: ['forest', 'tree', 'woodland', 'jungle'],
  night: ['night_sky', 'night', 'moon', 'stars'],
  sky: ['sky', 'blue_sky', 'cloudy', 'clouds'],
  document: ['document', 'paper', 'text', 'receipt', 'handwriting'],
  documents: ['document', 'paper', 'text', 'receipt', 'handwriting'],
  receipt: ['receipt', 'document'],
  baby: ['baby', 'infant', 'toddler'],
  kids: ['child', 'kid', 'baby', 'toddler'],
  party: ['party', 'celebration', 'birthday', 'cake', 'balloon'],
  birthday: ['birthday', 'cake', 'candle', 'party', 'celebration'],
  wedding: ['wedding', 'bride', 'groom', 'ceremony', 'wedding_dress']
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const PEOPLE = new Set(['people', 'person', 'persons', 'face', 'faces', 'selfie', 'selfies', 'portrait', 'portraits', 'friends', 'family'])

interface SearchRow extends ItemRow {
  label_text: string | null
  labels: string | null
}

export function search(text: string): MediaItem[] {
  const tokens = text
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  if (!tokens.length) return []

  const where: string[] = [VISIBLE]
  const params: (string | number)[] = []
  const labelWanted: string[][] = []

  for (const token of tokens) {
    if (/^(19|20)\d\d$/.test(token)) {
      where.push(`strftime('%Y', COALESCE(m.taken_at, m.btime, m.mtime) / 1000, 'unixepoch', 'localtime') = ?`)
      params.push(token)
      continue
    }
    const month = MONTHS.findIndex((m) => m.startsWith(token) && token.length >= 3)
    if (month >= 0) {
      where.push(`strftime('%m', COALESCE(m.taken_at, m.btime, m.mtime) / 1000, 'unixepoch', 'localtime') = ?`)
      params.push(String(month + 1).padStart(2, '0'))
      continue
    }
    if (/^videos?$/.test(token)) {
      where.push(`m.kind = 'video'`)
      continue
    }
    if (/^(photos?|pictures?|images?)$/.test(token)) {
      where.push(`m.kind = 'image'`)
      continue
    }
    if (/^screenshots?$/.test(token)) {
      where.push(`(m.name LIKE '%screenshot%' OR m.name LIKE '%screen shot%' OR m.user_comment = 'Screenshot')`)
      continue
    }
    if (PEOPLE.has(token)) {
      where.push(`m.face_count > 0`)
      continue
    }
    const words = SYNONYMS[token] ?? [token.replace(/-/g, '_')]
    labelWanted.push(words)
    const labelClause = words.map(() => `m.label_text LIKE ?`).join(' OR ')
    where.push(`(${labelClause} OR m.name LIKE ? OR m.dir LIKE ? OR m.camera LIKE ?)`)
    params.push(...words.map((w) => `%${w}%`), `%${token}%`, `%${token}%`, `%${token}%`)
  }

  const rows = all<SearchRow>(
    `SELECT ${ITEM_COLUMNS}, m.label_text, m.labels FROM media m WHERE ${where.join(' AND ')} ORDER BY t DESC LIMIT 5000`,
    ...params
  )
  if (!labelWanted.length) return rows.map(toItem)

  // Rank by how confident Vision was about the matching labels.
  const relevance = (r: SearchRow): number => {
    let labels: [string, number][] = []
    try {
      labels = JSON.parse(r.labels ?? '[]')
    } catch {
      // unranked
    }
    let total = 0
    for (const words of labelWanted) {
      let best = 0
      for (const [label, conf] of labels) if (words.some((w) => label.includes(w))) best = Math.max(best, conf)
      total += best
    }
    return total
  }
  return rows
    .map((r) => ({ r, score: relevance(r) }))
    .sort((a, b) => b.score - a.score || b.r.t - a.r.t)
    .map(({ r }) => toItem(r))
}
