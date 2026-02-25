import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDeck, removeDeckCard, importDecklist, getMissingCards, upsertDeckCard, moveCard, setCommander } from '../api'
import type { DeckCard, ScryfallCard } from '../types'
import OwnershipBadge from '../components/OwnershipBadge'
import CardAutocomplete from '../components/CardAutocomplete'
import PrintingPickerModal from '../components/PrintingPickerModal'

type TargetBoard = 'mainboard' | 'maybeboard'

// ── Card image tile ───────────────────────────────────────────────────────────
function DeckCardTile({
  card,
  board,
  onRemove,
  onMove,
}: {
  card: DeckCard
  board: TargetBoard
  onRemove: () => void
  onMove: () => void
}) {
  const moveLabel = board === 'mainboard' ? '→ Maybe' : '→ Main'

  return (
    <div className="relative group">
      {card.image_uri ? (
        <img src={card.image_uri} alt={card.name} className="w-full rounded-lg" loading="lazy" />
      ) : (
        <div className="aspect-[2.5/3.5] bg-mtg-card rounded-lg flex items-center justify-center text-xs text-gray-500 px-2 text-center">
          {card.name}
        </div>
      )}

      {card.quantity > 1 && (
        <div className="absolute top-1 left-1 bg-black/80 text-white text-xs font-bold px-1.5 py-0.5 rounded">
          ×{card.quantity}
        </div>
      )}

      <div className="absolute top-1 right-1">
        <OwnershipBadge ownership={card._ownership} needed={board === 'mainboard' ? card.quantity : 0} />
      </div>

      <div className="absolute inset-0 bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-end gap-1.5 pb-2 px-2">
        <span className="text-xs text-white font-medium text-center leading-tight line-clamp-2">{card.name}</span>
        <div className="flex gap-1">
          <button onClick={onMove} className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-1.5 py-0.5 rounded">
            {moveLabel}
          </button>
          <button onClick={onRemove} className="text-xs bg-red-900 hover:bg-red-700 text-white px-1.5 py-0.5 rounded">
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}

const CARD_GRID = 'grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2'

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DeckDetail() {
  const { id } = useParams<{ id: string }>()
  const deckId = parseInt(id!)
  const qc = useQueryClient()

  const [showMissing, setShowMissing] = useState(false)
  const [showMaybe, setShowMaybe] = useState(false)
  const [targetBoard, setTargetBoard] = useState<TargetBoard>('mainboard')
  const [addQty, setAddQty] = useState(1)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')

  // Commander change state
  const [changingCommander, setChangingCommander] = useState(false)
  const [commanderPicker, setCommanderPicker] = useState<{ oracleId: string; cardName: string } | null>(null)

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
      upsertDeckCard(deckId, { name: card.name, oracle_id: card.oracle_id, scryfall_id: card.id, quantity: qty, board }),
    onSuccess: invalidate,
  })

  const importMutation = useMutation({
    mutationFn: () => importDecklist(deckId, importText, targetBoard),
    onSuccess: (res) => {
      invalidate()
      setShowImport(false)
      setImportText('')
      if (res.failed?.length) alert(`Failed:\n${res.failed.map((f: any) => `${f.line}: ${f.reason}`).join('\n')}`)
    },
  })

  const setCommanderMutation = useMutation({
    mutationFn: (card: ScryfallCard) =>
      setCommander(deckId, { name: card.name, oracle_id: card.oracle_id, scryfall_id: card.id }),
    onSuccess: () => {
      invalidate()
      setChangingCommander(false)
      setCommanderPicker(null)
    },
  })

  if (isLoading) return <div className="p-6 text-gray-400">Loading deck...</div>
  if (!deck) return <div className="p-6 text-red-400">Deck not found</div>

  const commander: DeckCard | undefined = deck.cards.find((c: DeckCard) => c.board === 'commander')
  const mainboard: DeckCard[] = deck.cards.filter((c: DeckCard) => c.board === 'mainboard')
  const maybeboard: DeckCard[] = deck.cards.filter((c: DeckCard) => c.board === 'maybeboard')
  const sorted = [...mainboard].sort((a, b) => (a.cmc ?? 0) - (b.cmc ?? 0) || a.name.localeCompare(b.name))

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <Link to="/decks" className="text-xs text-gray-500 hover:text-gray-300">← All Decks</Link>
          <h1 className="text-2xl font-bold mt-1">{deck.name}</h1>
        </div>
        <div className="text-right text-sm space-y-0.5">
          <div className="text-gray-300">{deck.stats.total_cards} cards</div>
          {deck.stats.missing_cards > 0 && (
            <button onClick={() => setShowMissing(v => !v)} className="text-red-400 hover:underline text-xs block">
              {deck.stats.missing_cards} missing
            </button>
          )}
          <div className="text-mtg-gold text-xs">~${deck.stats.total_price.toFixed(2)}</div>
        </div>
      </div>

      {/* ── Missing cards panel ── */}
      {showMissing && missing && (
        <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-4 space-y-2">
          <h3 className="font-semibold text-red-300 text-sm">Cards to acquire</h3>
          {missing.data.map((c: any) => (
            <div key={c.oracle_id} className="flex justify-between items-center text-sm">
              <span>{c.name}</span>
              <span className="text-red-400 text-xs">need {c.need_to_acquire} more</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Commander section ── */}
      <div className="bg-mtg-surface rounded-xl p-4 border border-yellow-800/40">
        <div className="text-xs text-yellow-600 uppercase tracking-wider font-semibold mb-3">Commander</div>
        {commander ? (
          <div className="flex gap-4 items-start">
            {commander.image_uri ? (
              <img src={commander.image_uri} alt={commander.name} className="w-36 rounded-lg flex-shrink-0" />
            ) : (
              <div className="w-36 aspect-[2.5/3.5] bg-mtg-card rounded-lg flex items-center justify-center text-xs text-gray-500 px-2 text-center">
                {commander.name}
              </div>
            )}
            <div className="space-y-1 min-w-0">
              <div className="text-lg font-bold">{commander.name}</div>
              {commander.type_line && <div className="text-sm text-gray-400">{commander.type_line}</div>}
              {commander.mana_cost && <div className="text-sm text-gray-500">{commander.mana_cost}</div>}
              <div className="pt-1">
                <OwnershipBadge ownership={commander._ownership} needed={1} />
              </div>
              {changingCommander ? (
                <div className="pt-2 space-y-1 max-w-xs">
                  <CardAutocomplete
                    placeholder="Search for new commander..."
                    onSelect={card => {
                      setChangingCommander(false)
                      setCommanderPicker({ oracleId: card.oracle_id, cardName: card.name })
                    }}
                    className=""
                  />
                  <button onClick={() => setChangingCommander(false)} className="text-xs text-gray-500 hover:text-gray-300">
                    Cancel
                  </button>
                </div>
              ) : (
                <button onClick={() => setChangingCommander(true)} className="btn-secondary text-xs mt-2">
                  Change
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2 max-w-xs">
            <div className="text-sm text-gray-500">No commander set</div>
            <CardAutocomplete
              placeholder="Search for commander..."
              onSelect={card => setCommanderPicker({ oracleId: card.oracle_id, cardName: card.name })}
              className=""
            />
          </div>
        )}
      </div>

      {/* Commander printing picker */}
      {commanderPicker && (
        <PrintingPickerModal
          oracle_id={commanderPicker.oracleId}
          cardName={commanderPicker.cardName}
          onSelect={printing => setCommanderMutation.mutate(printing)}
          onClose={() => { setCommanderPicker(null); setChangingCommander(false) }}
          hidePrices
        />
      )}

      {/* ── Add card controls ── */}
      <div className="space-y-2">
        <div className="flex gap-2 items-center">
          <CardAutocomplete
            placeholder="Add a card..."
            onSelect={(card) => addMutation.mutate({ card, board: targetBoard, qty: addQty })}
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
          <div className="flex rounded-lg overflow-hidden border border-gray-600 text-xs flex-shrink-0">
            {(['mainboard', 'maybeboard'] as TargetBoard[]).map(b => (
              <button
                key={b}
                onClick={() => setTargetBoard(b)}
                className={`px-2.5 py-1.5 transition-colors ${
                  targetBoard === b ? 'bg-mtg-accent text-white' : 'bg-mtg-card text-gray-400 hover:text-gray-200'
                }`}
              >
                {b === 'mainboard' ? 'Main' : 'Maybe'}
              </button>
            ))}
          </div>
          <button onClick={() => setShowImport(v => !v)} className="btn-secondary text-xs flex-shrink-0">
            {showImport ? 'Cancel' : '⬆ Paste'}
          </button>
        </div>

        {showImport && (
          <div className="bg-mtg-surface rounded-lg p-3 space-y-2 border border-gray-700">
            <textarea
              className="input h-32 font-mono text-xs resize-none w-full"
              placeholder={"1 Ramos, Dragon Engine (FDN) 678\n1 Sol Ring"}
              value={importText}
              onChange={e => setImportText(e.target.value)}
            />
            <button
              onClick={() => importMutation.mutate()}
              disabled={!importText.trim() || importMutation.isPending}
              className="btn-primary text-xs w-full disabled:opacity-40"
            >
              {importMutation.isPending ? 'Importing...' : `Import to ${targetBoard === 'mainboard' ? 'Mainboard' : 'Maybeboard'}`}
            </button>
          </div>
        )}
      </div>

      {/* ── Mainboard grid ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 border-b border-gray-700 pb-2">
          <h2 className="font-semibold">Mainboard</h2>
          <span className="text-xs bg-mtg-card px-2 py-0.5 rounded-full text-gray-400">
            {deck.stats.total_cards} cards
          </span>
        </div>
        {mainboard.length === 0 ? (
          <div className="text-center text-gray-600 py-8 text-sm">No cards yet — search above or paste a list</div>
        ) : (
          <div className={CARD_GRID}>
            {sorted.map(card => (
              <DeckCardTile
                key={card.id}
                card={card}
                board="mainboard"
                onRemove={() => removeMutation.mutate({ oracleId: card.oracle_id, board: 'mainboard' })}
                onMove={() => moveMutation.mutate({ oracleId: card.oracle_id, fromBoard: 'mainboard', toBoard: 'maybeboard' })}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Maybeboard (collapsible) ── */}
      <div>
        <button
          onClick={() => setShowMaybe(v => !v)}
          className="text-sm text-gray-500 hover:text-gray-300 flex items-center gap-1 transition-colors"
        >
          <span>{showMaybe ? '▾' : '▸'}</span>
          Maybeboard
          <span className="text-xs text-gray-600 ml-1">({maybeboard.reduce((s, c) => s + c.quantity, 0)} cards)</span>
        </button>

        {showMaybe && (
          <div className="mt-3">
            {maybeboard.length === 0 ? (
              <div className="text-xs text-gray-600 py-2">No cards in maybeboard</div>
            ) : (
              <div className={CARD_GRID}>
                {[...maybeboard].sort((a, b) => a.name.localeCompare(b.name)).map(card => (
                  <DeckCardTile
                    key={card.id}
                    card={card}
                    board="maybeboard"
                    onRemove={() => removeMutation.mutate({ oracleId: card.oracle_id, board: 'maybeboard' })}
                    onMove={() => moveMutation.mutate({ oracleId: card.oracle_id, fromBoard: 'maybeboard', toBoard: 'mainboard' })}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
