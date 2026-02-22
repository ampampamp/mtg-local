export interface Ownership {
  owned: number
  owned_normal: number
  owned_foil: number
  in_use: number
  available: number
  decks: { deck_id: number; deck_name: string; quantity: number }[]
}

export interface ScryfallCard {
  id: string
  oracle_id: string
  name: string
  mana_cost?: string
  cmc?: number
  type_line?: string
  oracle_text?: string
  colors?: string[]
  image_uris?: { normal: string; small: string; art_crop: string }
  card_faces?: { name: string; image_uris?: { normal: string } }[]
  set: string
  set_name: string
  collector_number: string
  prices?: { usd?: string; usd_foil?: string }
  _ownership?: Ownership
}

export interface CollectionEntry {
  id: number
  scryfall_id: string
  oracle_id: string
  name: string
  set_code: string
  collector_number: string
  quantity: number
  foil_quantity: number
  condition: string
  image_uri?: string
  prices?: { usd?: string; usd_foil?: string }
  set_name: string
  _ownership?: Ownership
}

export interface Deck {
  id: number
  name: string
  format: string
  description: string
  created_at: string
  updated_at: string
}

export interface DeckCard {
  id: number
  oracle_id: string
  scryfall_id?: string
  name: string
  quantity: number
  board: string
  image_uri?: string
  mana_cost?: string
  type_line?: string
  cmc?: number
  colors?: string[]
  prices?: { usd?: string }
  _ownership?: Ownership
}

export interface DeckDetail extends Deck {
  cards: DeckCard[]
  stats: {
    total_cards: number
    sideboard_cards: number
    missing_cards: number
    total_price: number
  }
}
