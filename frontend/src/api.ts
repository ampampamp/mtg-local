import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export default api

// Cards
export const autocompleteCards = (q: string, limit = 20) =>
  api.get('/cards/autocomplete', { params: { q, limit } }).then(r => r.data)

export const getCardPrintings = (oracle_id: string) =>
  api.get('/cards/printings', { params: { oracle_id } }).then(r => r.data)

export const searchCards = (q: string, page = 1, order = 'name') =>
  api.get('/cards/search', { params: { q, page, order } }).then(r => r.data)

// Collection
export const getCollection = () =>
  api.get('/collection').then(r => r.data)

export const upsertCollectionCard = (data: {
  scryfall_id: string
  quantity: number
  foil_quantity: number
  condition: string
}) => api.post('/collection', data).then(r => r.data)

export const deleteCollectionCard = (scryfall_id: string) =>
  api.delete(`/collection/${scryfall_id}`).then(r => r.data)

export const importCollection = (csv: string, mode: 'append' | 'replace' = 'append') =>
  api.post('/collection/import', { csv, mode }).then(r => r.data)

// Decks
export const getDecks = () =>
  api.get('/decks').then(r => r.data)

export const createDeck = (data: { name: string; format: string; description: string; decklist?: string; commander_scryfall_id?: string }) =>
  api.post('/decks', data).then(r => r.data)

export const setCommander = (deckId: number, data: { name: string; oracle_id: string; scryfall_id: string }) =>
  api.put(`/decks/${deckId}/commander`, { ...data, quantity: 1, board: 'commander' }).then(r => r.data)

export const getDeck = (id: number) =>
  api.get(`/decks/${id}`).then(r => r.data)

export const updateDeck = (id: number, data: { name: string; format: string; description: string }) =>
  api.put(`/decks/${id}`, data).then(r => r.data)

export const deleteDeck = (id: number) =>
  api.delete(`/decks/${id}`).then(r => r.data)

export const upsertDeckCard = (deckId: number, data: {
  name: string
  oracle_id?: string
  scryfall_id?: string
  quantity: number
  board: string
  tags?: string[]
}) => api.post(`/decks/${deckId}/cards`, data).then(r => r.data)

export const removeDeckCard = (deckId: number, oracleId: string, board = 'mainboard') =>
  api.delete(`/decks/${deckId}/cards/${oracleId}`, { params: { board } }).then(r => r.data)
export const moveCard = (deckId: number, data: {
  oracle_id: string
  from_board: string
  to_board: string
}) => api.post(`/decks/${deckId}/cards/move`, data).then(r => r.data)

export const getMissingCards = (deckId: number) =>
  api.get(`/decks/${deckId}/missing`).then(r => r.data)

export const importDecklist = (deckId: number, text: string, board = 'mainboard') =>
  api.post(`/decks/${deckId}/import`, { text, board }).then(r => r.data)

// System
export const getBulkStatus = () =>
  api.get('/system/bulk-status').then(r => r.data)

export const triggerBulkRefresh = () =>
  api.post('/system/bulk-refresh').then(r => r.data)
