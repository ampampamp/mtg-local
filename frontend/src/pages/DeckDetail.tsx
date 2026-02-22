import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDeck, removeDeckCard, importDecklist, getMissingCards, upsertDeckCard, moveCard } from '../api'
import type { DeckCard, ScryfallCard } from '../types'
import OwnershipBadge from '../components/OwnershipBadge'
import CardAutocomplete from '../components/CardAutocomplete'
import clsx from 'clsx'

type ActiveAdd = 'mainboard' | 'sideboard' | 'maybeboard'

function groupByType(cards: DeckCard[]) {
  const groups: Record<string, DeckCard[]> = {}
  for (const card of cards) {
    const type =
      card.type_line
        ?.split('—')[0]
        ?.split(' ')
        .find(t =>
          ['Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Planeswalker', 'Land', 'Battle'].includes(t)
        ) ?? 'Other'
    groups[type] = [...(groups[type] ?? []), card]
  }
  return groups
}

const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Land', 'Battle', 'Other']

// ── Single card row ──────────────────────────────────────────────────────────
function CardRow({
  card,
  board,
  onRemove,
  onMove,
}: {
  card: DeckCard
  board: 'mainboard' | 'sideboard' | 'maybeboard'
  onRemove: () => void
  onMove: (toBoard: 'mainboard' | 'sideboard') => void
}) {
  const moveTarget = board === 'mainboard' ? 'sideboard' : 'mainboard'
  const moveLabel = board === 'mainboard' ? '→ SB' : '→ MB'

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-mtg-surface/60 group text-sm">
      <span className="text-gray-500 w-4 text-right flex-shrink-0">{card.quantity}</span>

      {card.image_uri && (
        <img src={card.image_uri} alt="" className="w-6 h-8 rounded object-cover flex-shrink-0" />
      )}

      <span className="flex-1 font-medium truncate">{card.name}</span>
      <span className="text-xs text-gray-600 hidden sm:block">{card.mana_cost}</span>

      {card.prices?.usd && (
        <span className="text-xs text-mtg-gold flex-shrink-0">${card.prices.usd}</span>
      )}

      <OwnershipBadge
        ownership={card._ownership}
        needed={board === 'mainboard' ? card.quantity : 0}
      />

      {/* Move button — only between mainboard and sideboard */}
      {board !== 'maybeboard' && (
        <button
          onClick={() => onMove(moveTarget as 'mainboard' | 'sideboard')}
          title={`Move to ${moveTarget}`}
          className="text-xs text-gray-600 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 font-mono"
        >
          {moveLabel}
        </button>
      )}

      <button
        onClick={onRemove}
        title="Remove"
        className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-xs flex-shrink-0"
      >
        ✕
      </button>
    </div>
  )
}

// ── Board column ─────────────────────────────────────────────────────────────
function BoardColumn({
  title,
  badge,
  cards,
  board,
  addQty,
  setAddQty,
  onAddCard,
  onRemove,
  onMove,
  showImport,
  onToggleImport,
  importText,
  setImportText,
  onImport,
  importing,
  accent,
}: {
  title: string
  badge: string
  cards: DeckCard[]
  board: 'mainboard' | 'sideboard'
  addQty: number
  setAddQty: (n: number) => void
  onAddCard: (card: ScryfallCard) => void
  onRemove: (card: DeckCard) => void
  onMove: (card: DeckCard, toBoard: 'mainboard' | 'sideboard') => void
  showImport: boolean
  onToggleImport: () => void
  importText: string
  setImportText: (s: string) => void
  onImport: () => void
  importing: boolean
  accent: string
}) {
  const groups = groupByType(cards)
  const total = cards.reduce((s, c) => s + c.quantity, 0)

  return (
    <div className="flex flex-col gap-3">
      {/* Column header */}
      <div className={clsx('flex items-center justify-between border-b pb-2', accent)}>
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-base">{title}</h2>
          <span className="text-xs bg-mtg-card px-2 py-0.5 rounded-full text-gray-400">
            {total} {badge}
          </span>
        </div>
        <button onClick={onToggleImport} className="btn-secondary text-xs">
          {showImport ? 'Cancel' : '⬆ Paste'}
        </button>
      </div>

      {/* Add card search */}
      <div className="flex gap-2 items-center">
        <CardAutocomplete
          placeholder={`Add to ${title.toLowerCase()}...`}
          onSelect={onAddCard}
          clearOnSelect
          className="flex-1"
        />
        <input
          type="number"
          min={1}
          max={99}
          value={addQty}
          onChange={e => setAddQty(Math.max(1, parseInt(e.target.value) || 1))}
          className="input w-14 text-center text-sm"
          title="Quantity"
        />
      </div>

      {/* Paste import */}
      {showImport && (
        <div className="bg-mtg-surface rounded-lg p-3 space-y-2 border border-gray-700">
          <textarea
            className="input h-32 font-mono text-xs resize-none"
            placeholder={"4 Lightning Bolt\n1 Sol Ring"}
            value={importText}
            onChange={e => setImportText(e.target.value)}
          />
          <button
            onClick={onImport}
            disabled={!importText.trim() || importing}
            className="btn-primary text-xs w-full disabled:opacity-40"
          >
            {importing ? 'Importing...' : `Import to ${title}`}
          </button>
        </div>
      )}

      {/* Card list grouped by type */}
      <div className="space-y-4">
        {TYPE_ORDER.filter(t => groups[t]?.length).map(type => (
          <div key={type}>
            <div className="text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
              {type} ({groups[type].reduce((s, c) => s + c.quantity, 0)})
            </div>
            {groups[type]
              .sort((a, b) => (a.cmc ?? 0) - (b.cmc ?? 0) || a.name.localeCompare(b.name))
              .map(card => (
                <CardRow
                  key={card.id}
                  card={card}
                  board={board}
                  onRemove={() => onRemove(card)}
                  onMove={(toBoard) => onMove(card, toBoard)}
                />
              ))}
          </div>
        ))}

        {cards.length === 0 && (
          <div className="text-center text-gray-600 py-8 text-sm">
            No cards yet — search above or paste a list
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DeckDetail() {
  const { id } = useParams<{ id: string }>()
  const deckId = parseInt(id!)
  const qc = useQueryClient()

  const [showMissing, setShowMissing] = useState(false)
  const [showMaybe, setShowMaybe] = useState(false)

  // Per-board add state
  const [mbQty, setMbQty] = useState(1)
  const [sbQty, setSbQty] = useState(1)
  const [mbShowImport, setMbShowImport] = useState(false)
  const [sbShowImport, setSbShowImport] = useState(false)
  const [mbImportText, setMbImportText] = useState('')
  const [sbImportText, setSbImportText] = useState('')

  const { data: deck, isLoading } = useQuery({
    queryKey: ['deck', deckId],
    queryFn: () => getDeck(deckId),
  })

  const { data: missing } = useQuery({
    queryKey: ['deck-missing', deckId],
    queryFn: () => getMissingCards(deckId),
    enabled: showMissing,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['deck', deckId] })

  const removeMutation = useMutation({
    mutationFn: ({ oracleId, board }: { oracleId: string; board: string }) =>
      removeDeckCard(deckId, oracleId, board),
    onSuccess: invalidate,
  })

  const moveMutation = useMutation({
    mutationFn: ({ oracleId, fromBoard, toBoard }: { oracleId: string; fromBoard: string; toBoard: string }) =>
      moveCard(deckId, { oracle_id: oracleId, from_board: fromBoard, to_board: toBoard }),
    onSuccess: invalidate,
  })

  const addMutation = useMutation({
    mutationFn: ({ card, board, qty }: { card: ScryfallCard; board: string; qty: number }) =>
      upsertDeckCard(deckId, {
        name: card.name,
        oracle_id: card.oracle_id,
        scryfall_id: card.id,
        quantity: qty,
        board,
      }),
    onSuccess: invalidate,
  })

  const mbImportMutation = useMutation({
    mutationFn: () => importDecklist(deckId, mbImportText, 'mainboard'),
    onSuccess: (res) => {
      invalidate()
      setMbShowImport(false)
      setMbImportText('')
      if (res.failed?.length) alert(`Failed:\n${res.failed.map((f: any) => `${f.line}: ${f.reason}`).join('\n')}`)
    },
  })

  const sbImportMutation = useMutation({
    mutationFn: () => importDecklist(deckId, sbImportText, 'sideboard'),
    onSuccess: (res) => {
      invalidate()
      setSbShowImport(false)
      setSbImportText('')
      if (res.failed?.length) alert(`Failed:\n${res.failed.map((f: any) => `${f.line}: ${f.reason}`).join('\n')}`)
    },
  })

  if (isLoading) return <div className="p-6 text-gray-400">Loading deck...</div>
  if (!deck) return <div className="p-6 text-red-400">Deck not found</div>

  const mainboard: DeckCard[] = deck.cards.filter((c: DeckCard) => c.board === 'mainboard')
  const sideboard: DeckCard[] = deck.cards.filter((c: DeckCard) => c.board === 'sideboard')
  const maybeboard: DeckCard[] = deck.cards.filter((c: DeckCard) => c.board === 'maybeboard')

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <Link to="/decks" className="text-xs text-gray-500 hover:text-gray-300">← All Decks</Link>
          <h1 className="text-2xl font-bold mt-1">{deck.name}</h1>
          <div className="text-sm text-gray-400 capitalize">{deck.format}</div>
        </div>
        <div className="text-right text-sm space-y-0.5">
          <div className="text-gray-300">
            {deck.stats.total_cards} main
            {deck.stats.sideboard_cards > 0 && (
              <span className="text-gray-500"> · {deck.stats.sideboard_cards} side</span>
            )}
          </div>
          {deck.stats.missing_cards > 0 && (
            <button onClick={() => setShowMissing(v => !v)} className="text-red-400 hover:underline text-xs block">
              {deck.stats.missing_cards} missing from mainboard
            </button>
          )}
          <div className="text-mtg-gold text-xs">~${deck.stats.total_price.toFixed(2)}</div>
        </div>
      </div>

      {/* ── Missing cards panel ── */}
      {showMissing && missing && (
        <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-4 space-y-2">
          <h3 className="font-semibold text-red-300 text-sm">Cards to acquire (mainboard only)</h3>
          {missing.data.map((c: any) => (
            <div key={c.oracle_id} className="flex justify-between items-center text-sm">
              <span>{c.name}</span>
              <span className="text-red-400 text-xs">need {c.need_to_acquire} more</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Sideboard note ── */}
      <div className="text-xs text-gray-600 italic">
        Sideboard cards are not counted as "in use" in your collection stats.
      </div>

      {/* ── Main split layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <BoardColumn
          title="Mainboard"
          badge="cards"
          cards={mainboard}
          board="mainboard"
          addQty={mbQty}
          setAddQty={setMbQty}
          onAddCard={(card) => addMutation.mutate({ card, board: 'mainboard', qty: mbQty })}
          onRemove={(card) => removeMutation.mutate({ oracleId: card.oracle_id, board: 'mainboard' })}
          onMove={(card, toBoard) => moveMutation.mutate({ oracleId: card.oracle_id, fromBoard: 'mainboard', toBoard })}
          showImport={mbShowImport}
          onToggleImport={() => setMbShowImport(v => !v)}
          importText={mbImportText}
          setImportText={setMbImportText}
          onImport={() => mbImportMutation.mutate()}
          importing={mbImportMutation.isPending}
          accent="border-gray-700"
        />

        <BoardColumn
          title="Sideboard"
          badge="cards"
          cards={sideboard}
          board="sideboard"
          addQty={sbQty}
          setAddQty={setSbQty}
          onAddCard={(card) => addMutation.mutate({ card, board: 'sideboard', qty: sbQty })}
          onRemove={(card) => removeMutation.mutate({ oracleId: card.oracle_id, board: 'sideboard' })}
          onMove={(card, toBoard) => moveMutation.mutate({ oracleId: card.oracle_id, fromBoard: 'sideboard', toBoard })}
          showImport={sbShowImport}
          onToggleImport={() => setSbShowImport(v => !v)}
          importText={sbImportText}
          setImportText={setSbImportText}
          onImport={() => sbImportMutation.mutate()}
          importing={sbImportMutation.isPending}
          accent="border-gray-700"
        />
      </div>

      {/* ── Maybeboard (collapsible) ── */}
      <div>
        <button
          onClick={() => setShowMaybe(v => !v)}
          className="text-sm text-gray-500 hover:text-gray-300 flex items-center gap-1 transition-colors"
        >
          <span>{showMaybe ? '▾' : '▸'}</span>
          Maybeboard
          <span className="text-xs text-gray-600 ml-1">
            ({maybeboard.reduce((s, c) => s + c.quantity, 0)} cards)
          </span>
        </button>

        {showMaybe && (
          <div className="mt-3 pl-2 border-l border-gray-700 space-y-1">
            {maybeboard.length === 0 && (
              <div className="text-xs text-gray-600 py-2">No cards in maybeboard</div>
            )}
            {maybeboard
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(card => (
                <div key={card.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-mtg-surface/50 group text-sm">
                  <span className="text-gray-500 w-4 text-right">{card.quantity}</span>
                  <span className="flex-1 truncate">{card.name}</span>
                  <OwnershipBadge ownership={card._ownership} needed={0} />
                  <button
                    onClick={() => moveMutation.mutate({ oracleId: card.oracle_id, fromBoard: 'maybeboard', toBoard: 'mainboard' })}
                    className="text-xs text-gray-600 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all font-mono"
                    title="Move to mainboard"
                  >
                    → MB
                  </button>
                  <button
                    onClick={() => moveMutation.mutate({ oracleId: card.oracle_id, fromBoard: 'maybeboard', toBoard: 'sideboard' })}
                    className="text-xs text-gray-600 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all font-mono"
                    title="Move to sideboard"
                  >
                    → SB
                  </button>
                  <button
                    onClick={() => removeMutation.mutate({ oracleId: card.oracle_id, board: 'maybeboard' })}
                    className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-xs"
                  >✕</button>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
