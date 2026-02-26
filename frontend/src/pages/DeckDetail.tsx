import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDeck, removeDeckCard, importDecklist, getMissingCards, upsertDeckCard, moveCard, setCommander, renameDeck } from '../api'
import type { DeckCard, ScryfallCard } from '../types'
import OwnershipBadge from '../components/OwnershipBadge'
import CardAutocomplete from '../components/CardAutocomplete'
import PrintingPickerModal from '../components/PrintingPickerModal'
import ManaCost from '../components/ManaCost'
import EditDeckCardModal from '../components/EditDeckCardModal'

// ── Types ─────────────────────────────────────────────────────────────────────
type TargetBoard = 'mainboard' | 'maybeboard'
type SortBy = 'cmc' | 'alpha'
type Grouping = 'none' | 'type' | 'tags'
interface CardGroup { label: string; cards: DeckCard[] }

// ── Grouping / sort helpers ───────────────────────────────────────────────────
const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land']

function getCardType(typeLine = ''): string {
  for (const t of TYPE_ORDER) if (typeLine.includes(t)) return t
  return 'Other'
}

function sortCards(cards: DeckCard[], sortBy: SortBy): DeckCard[] {
  return [...cards].sort((a, b) =>
    sortBy === 'cmc'
      ? (a.cmc ?? 0) - (b.cmc ?? 0) || a.name.localeCompare(b.name)
      : a.name.localeCompare(b.name)
  )
}

function groupCards(cards: DeckCard[], grouping: Grouping, sortBy: SortBy): CardGroup[] {
  const sorted = sortCards(cards, sortBy)

  if (grouping === 'none') return [{ label: '', cards: sorted }]

  if (grouping === 'type') {
    const buckets: Record<string, DeckCard[]> = Object.fromEntries(
      [...TYPE_ORDER, 'Other'].map(t => [t, []])
    )
    for (const card of sorted) buckets[getCardType(card.type_line)].push(card)
    return [...TYPE_ORDER, 'Other']
      .filter(t => buckets[t].length > 0)
      .map(t => ({ label: t, cards: buckets[t] }))
  }

  // tags — cards can appear in multiple sections
  const tagMap: Record<string, DeckCard[]> = {}
  const untagged: DeckCard[] = []
  for (const card of sorted) {
    const tags = card.tags ?? []
    if (!tags.length) { untagged.push(card); continue }
    for (const tag of tags) {
      if (!tagMap[tag]) tagMap[tag] = []
      tagMap[tag].push(card)
    }
  }
  const sections = Object.entries(tagMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, cards]) => ({ label, cards }))
  if (untagged.length) sections.push({ label: 'Untagged', cards: untagged })
  return sections
}

function loadPref<T>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T) ?? fallback } catch { return fallback }
}
function savePref(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch {}
}

// ── Annotated groups (sequential index per tile instance, no dedup) ───────────
type AnnotatedGroup = { label: string; cards: { card: DeckCard; seqIdx: number }[] }

function annotateGroups(groups: CardGroup[]): AnnotatedGroup[] {
  let idx = 0
  return groups.map(g => ({
    label: g.label,
    cards: g.cards.map(card => ({ card, seqIdx: idx++ })),
  }))
}

// ── Card image tile ───────────────────────────────────────────────────────────
function DeckCardTile({
  card, board, navIndex, selected, onRemove, onMove, onClick, onDoubleClick,
}: {
  card: DeckCard
  board: TargetBoard
  navIndex: number
  selected: boolean
  onRemove: () => void
  onMove: () => void
  onClick: () => void
  onDoubleClick: () => void
}) {
  const moveLabel = board === 'mainboard' ? '→ Maybe' : '→ Main'

  return (
    <div
      data-card-index={navIndex}
      className={`cursor-pointer rounded-lg ${selected ? 'ring-2 ring-blue-400' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
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
        <div className="absolute inset-0 bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-end gap-1.5 pb-2 px-2">
          <span className="text-xs text-white font-medium text-center leading-tight line-clamp-2">{card.name}</span>
          <div className="flex gap-1">
            <button onClick={e => { e.stopPropagation(); onMove() }} className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-1.5 py-0.5 rounded">
              {moveLabel}
            </button>
            <button onClick={e => { e.stopPropagation(); onRemove() }} className="text-xs bg-red-900 hover:bg-red-700 text-white px-1.5 py-0.5 rounded">
              ✕
            </button>
          </div>
        </div>
      </div>
      <div className="mt-1 flex justify-center">
        <OwnershipBadge ownership={card._ownership} needed={board === 'mainboard' ? card.quantity : 0} />
      </div>
    </div>
  )
}

// ── Section group renderer ────────────────────────────────────────────────────
function BoardSection({
  groups, board, selectedBoard, selectedIndex,
  onSelect, onDoubleClick, onRemove, onMove, containerRef,
}: {
  groups: AnnotatedGroup[]
  board: TargetBoard
  selectedBoard: TargetBoard | null
  selectedIndex: number | null
  onSelect: (seqIdx: number) => void
  onDoubleClick: (card: DeckCard) => void
  onRemove: (card: DeckCard) => void
  onMove: (card: DeckCard) => void
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  const CARD_GRID = 'grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2'
  const showHeaders = groups.length > 1 || (groups.length === 1 && groups[0].label !== '')

  return (
    <div ref={containerRef} className="space-y-4">
      {groups.map(({ label, cards }) => (
        <div key={label || '__flat__'}>
          {showHeaders && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
              <span className="text-xs text-gray-600">{cards.reduce((s, c) => s + c.card.quantity, 0)}</span>
            </div>
          )}
          <div className={CARD_GRID}>
            {cards.map(({ card, seqIdx }) => (
              <DeckCardTile
                key={`${label}-${card.id}`}
                card={card}
                board={board}
                navIndex={seqIdx}
                selected={selectedBoard === board && selectedIndex === seqIdx}
                onClick={() => onSelect(seqIdx)}
                onDoubleClick={() => onDoubleClick(card)}
                onRemove={() => onRemove(card)}
                onMove={() => onMove(card)}
              />
            ))}
          </div>
        </div>
      ))}
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
  const [targetBoard, setTargetBoard] = useState<TargetBoard>('mainboard')
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')

  // Commander change state
  const [changingCommander, setChangingCommander] = useState(false)
  const [commanderPicker, setCommanderPicker] = useState<{ oracleId: string; cardName: string } | null>(null)

  // Add card picker
  const [addPicker, setAddPicker] = useState<{ oracleId: string; cardName: string } | null>(null)

  // Grouping + sort (persisted)
  const [grouping, setGroupingState] = useState<Grouping>(() => loadPref('deck-grouping', 'type'))
  const [sortBy, setSortByState] = useState<SortBy>(() => loadPref('deck-sort', 'cmc'))

  function setGrouping(g: Grouping) { setGroupingState(g); savePref('deck-grouping', g) }
  function setSortBy(s: SortBy) { setSortByState(s); savePref('deck-sort', s) }

  // Keyboard navigation + edit modal
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [selectedBoard, setSelectedBoard] = useState<TargetBoard | null>(null)
  const [editModal, setEditModal] = useState<DeckCard | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [recentTags, setRecentTags] = useState<string[]>([])

  const [editingName, setEditingName] = useState(false)
  const [editingNameValue, setEditingNameValue] = useState('')

  const mainContainerRef = useRef<HTMLDivElement | null>(null)
  const maybeContainerRef = useRef<HTMLDivElement | null>(null)
  const addFocusRef = useRef<(() => void) | null>(null)
  const scrollPending = useRef(false)

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

  const renameMutation = useMutation({
    mutationFn: (name: string) => renameDeck(deckId, name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['decks'] }); invalidate(); setEditingName(false) },
  })

  function startEditingName() { setEditingNameValue(deck?.name ?? ''); setEditingName(true) }
  function commitRenameDeck() {
    if (!editingNameValue.trim()) { setEditingName(false); return }
    renameMutation.mutate(editingNameValue.trim())
  }

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
    mutationFn: ({ card, board }: { card: ScryfallCard; board: string }) =>
      upsertDeckCard(deckId, { name: card.name, oracle_id: card.oracle_id, scryfall_id: card.id, quantity: 1, board }),
    onSuccess: () => { invalidate(); setAddPicker(null) },
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
    onSuccess: () => { invalidate(); setChangingCommander(false); setCommanderPicker(null) },
  })

  // ── Derived card arrays ──────────────────────────────────────────────────
  const commander: DeckCard | undefined = deck?.cards.find((c: DeckCard) => c.board === 'commander')
  const mainboard: DeckCard[] = deck
    ? deck.cards.filter((c: DeckCard) => c.board === 'mainboard' && c.oracle_id !== commander?.oracle_id)
    : []
  const maybeboard: DeckCard[] = deck
    ? deck.cards.filter((c: DeckCard) => c.board === 'maybeboard')
    : []

  // All unique tags across all deck cards (for autocomplete)
  const allDeckTags = useMemo(() => {
    const all = [...mainboard, ...maybeboard]
    return [...new Set(all.flatMap(c => c.tags ?? []))]
  }, [deck])

  // Apply tag filter, then group for display
  const mainFiltered = tagFilter ? mainboard.filter(c => (c.tags ?? []).includes(tagFilter)) : mainboard
  const maybeFiltered = tagFilter ? maybeboard.filter(c => (c.tags ?? []).includes(tagFilter)) : maybeboard

  // Grouped arrays for display, annotated with per-instance sequential indices
  const mainGroups = annotateGroups(groupCards(mainFiltered, grouping, sortBy))
  const maybeGroups = annotateGroups(groupCards(maybeFiltered, grouping, sortBy))

  // Full visual sequences (with duplicates) — each tile instance gets its own index
  const mainNavSequence = mainGroups.flatMap(g => g.cards.map(c => c.card))
  const maybeNavSequence = maybeGroups.flatMap(g => g.cards.map(c => c.card))

  const openEdit = useCallback((card: DeckCard) => setEditModal(card), [])

  // Stable ref for keydown handler
  const handlerRef = useRef({ selectedIndex, selectedBoard, mainNavSequence, maybeNavSequence, editModal, addPicker, commanderPicker, grouping })
  handlerRef.current = { selectedIndex, selectedBoard, mainNavSequence, maybeNavSequence, editModal, addPicker, commanderPicker, grouping }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const { selectedIndex, selectedBoard, mainNavSequence, maybeNavSequence, editModal, addPicker, commanderPicker } = handlerRef.current
      const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase()
      const inInput = tag === 'input' || tag === 'textarea' || tag === 'select'

      if (e.key === 'Escape') {
        ;(document.activeElement as HTMLElement)?.blur()
        if (editModal) { setEditModal(null) }
        else if (!addPicker && !commanderPicker) { setSelectedIndex(null); setSelectedBoard(null) }
        return
      }

      if (inInput) return

      // 'a' focuses the add-card input
      if (e.key.toLowerCase() === 'a' && !editModal && !addPicker && !commanderPicker) {
        e.preventDefault()
        setSelectedIndex(null)
        setSelectedBoard(null)
        addFocusRef.current?.()
        return
      }

      if (e.key === 'Enter' && selectedIndex !== null && selectedBoard && !editModal) {
        e.preventDefault()
        const cards = selectedBoard === 'mainboard' ? mainNavSequence : maybeNavSequence
        const card = cards[selectedIndex]
        if (card) openEdit(card)
        return
      }

      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && !editModal && selectedBoard) {
        const cards = selectedBoard === 'mainboard' ? mainNavSequence : maybeNavSequence
        if (!cards.length) return
        e.preventDefault()

        const total = cards.length
        const cur = selectedIndex ?? -1
        let next = cur

        if (e.key === 'ArrowLeft') {
          next = cur <= 0 ? 0 : cur - 1
        } else if (e.key === 'ArrowRight') {
          next = cur < 0 ? 0 : Math.min(total - 1, cur + 1)
        } else {
          // Up/Down: find the visually adjacent card using DOM rects
          const containerRef = selectedBoard === 'mainboard' ? mainContainerRef : maybeContainerRef
          const container = containerRef.current
          if (!container || cur < 0) {
            next = 0
          } else {
            const allTiles = Array.from(container.querySelectorAll('[data-card-index]')) as HTMLElement[]
            const currentEl = allTiles.find(el => el.dataset.cardIndex === String(cur))
            if (currentEl) {
              const curRect = currentEl.getBoundingClientRect()
              const curCenter = curRect.left + curRect.width / 2
              const isDown = e.key === 'ArrowDown'

              const candidates = allTiles
                .map(el => ({ el, rect: el.getBoundingClientRect() }))
                .filter(({ rect }) => isDown
                  ? rect.top > curRect.bottom - 2
                  : rect.bottom < curRect.top + 2
                )

              if (candidates.length > 0) {
                const targetRowTop = isDown
                  ? Math.min(...candidates.map(c => c.rect.top))
                  : Math.max(...candidates.map(c => c.rect.top))
                const rowCards = candidates
                  .filter(c => Math.abs(c.rect.top - targetRowTop) < 4)
                  .sort((a, b) =>
                    Math.abs(a.rect.left + a.rect.width / 2 - curCenter) -
                    Math.abs(b.rect.left + b.rect.width / 2 - curCenter)
                  )
                if (rowCards[0]) next = parseInt(rowCards[0].el.dataset.cardIndex!)
              }
            }
          }
        }

        scrollPending.current = true
        setSelectedIndex(next)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openEdit])

  // Scroll selected card into view — only when navigating via keyboard
  useEffect(() => {
    if (!scrollPending.current || selectedIndex === null || !selectedBoard) return
    scrollPending.current = false
    const containerRef = selectedBoard === 'mainboard' ? mainContainerRef : maybeContainerRef
    const el = containerRef.current?.querySelector(`[data-card-index="${selectedIndex}"]`) as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedIndex, selectedBoard])

  if (isLoading) return <div className="p-6 text-gray-400">Loading deck...</div>
  if (!deck) return <div className="p-6 text-red-400">Deck not found</div>

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <Link to="/decks" className="text-xs text-gray-500 hover:text-gray-300">← All Decks</Link>
          {editingName ? (
            <input
              className="input text-2xl font-bold mt-1 py-0.5 px-2"
              value={editingNameValue}
              autoFocus
              onChange={e => setEditingNameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRenameDeck()
                if (e.key === 'Escape') setEditingName(false)
              }}
              onBlur={commitRenameDeck}
            />
          ) : (
            <div className="flex items-center gap-2 group mt-1">
              <h1 className="text-2xl font-bold">{deck.name}</h1>
              <button
                onClick={startEditingName}
                className="text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity text-lg"
                title="Rename deck"
              >
                ✎
              </button>
            </div>
          )}
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
            <div className="flex-shrink-0">
              {commander.image_uri ? (
                <img src={commander.image_uri} alt={commander.name} className="w-36 rounded-lg" />
              ) : (
                <div className="w-36 aspect-[2.5/3.5] bg-mtg-card rounded-lg flex items-center justify-center text-xs text-gray-500 px-2 text-center">
                  {commander.name}
                </div>
              )}
              <div className="mt-1 flex justify-center">
                <OwnershipBadge ownership={commander._ownership} needed={1} />
              </div>
            </div>
            <div className="space-y-1 min-w-0">
              <div className="text-lg font-bold">{commander.name}</div>
              {commander.type_line && <div className="text-sm text-gray-400">{commander.type_line}</div>}
              {commander.mana_cost && <div><ManaCost cost={commander.mana_cost} /></div>}
              {changingCommander ? (
                <div className="pt-2 space-y-1 max-w-xs">
                  <CardAutocomplete
                    placeholder="Search for new commander..."
                    onSelect={card => { setChangingCommander(false); setCommanderPicker({ oracleId: card.oracle_id, cardName: card.name }) }}
                    className=""
                  />
                  <button onClick={() => setChangingCommander(false)} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setChangingCommander(true)} className="btn-secondary text-xs mt-2">Change</button>
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

      {/* ── Grouping + sort toggles ── */}
      <div className="flex items-center gap-4 flex-wrap py-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Group</span>
          <div className="flex rounded overflow-hidden border border-gray-700 text-xs">
            {([['none', 'None'], ['type', 'Type'], ['tags', 'Tags']] as [Grouping, string][]).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setGrouping(val)}
                className={`px-2.5 py-1 transition-colors ${grouping === val ? 'bg-mtg-accent text-white' : 'bg-mtg-card text-gray-400 hover:text-gray-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Sort</span>
          <div className="flex rounded overflow-hidden border border-gray-700 text-xs">
            {([['cmc', 'CMC'], ['alpha', 'A→Z']] as [SortBy, string][]).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setSortBy(val)}
                className={`px-2.5 py-1 transition-colors ${sortBy === val ? 'bg-mtg-accent text-white' : 'bg-mtg-card text-gray-400 hover:text-gray-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Modals */}
      {addPicker && (
        <PrintingPickerModal
          oracle_id={addPicker.oracleId}
          cardName={addPicker.cardName}
          onSelect={printing => addMutation.mutate({ card: printing, board: targetBoard })}
          onClose={() => setAddPicker(null)}
          hidePrices
        />
      )}
      {commanderPicker && (
        <PrintingPickerModal
          oracle_id={commanderPicker.oracleId}
          cardName={commanderPicker.cardName}
          onSelect={printing => setCommanderMutation.mutate(printing)}
          onClose={() => { setCommanderPicker(null); setChangingCommander(false) }}
          hidePrices
        />
      )}
      {editModal && (
        <EditDeckCardModal
          card={editModal}
          deckId={deckId}
          onClose={() => setEditModal(null)}
          onFilterByTag={tag => { setEditModal(null); setTagFilter(tag) }}
          existingTags={allDeckTags}
          recentTags={recentTags}
          onSaved={savedTags => setRecentTags(prev => {
            const merged = [...savedTags, ...prev.filter(t => !savedTags.includes(t))]
            return merged.slice(0, 2)
          })}
        />
      )}

      {/* ── Add card controls ── */}
      <div className="space-y-2">
        <div className="flex gap-2 items-center">
          <CardAutocomplete
            placeholder="Add a card... (a)"
            onSelect={card => setAddPicker({ oracleId: card.oracle_id, cardName: card.name })}
            focusRef={addFocusRef}
            onFocus={() => { setSelectedIndex(null); setSelectedBoard(null) }}
            clearOnSelect
            className="flex-1"
          />
          <div className="flex rounded-lg overflow-hidden border border-gray-600 text-xs flex-shrink-0">
            {(['mainboard', 'maybeboard'] as TargetBoard[]).map(b => (
              <button
                key={b}
                onClick={() => setTargetBoard(b)}
                className={`px-2.5 py-1.5 transition-colors ${targetBoard === b ? 'bg-mtg-accent text-white' : 'bg-mtg-card text-gray-400 hover:text-gray-200'}`}
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

      {/* ── Mainboard ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 border-b border-gray-700 pb-2 flex-wrap">
          <h2 className="font-semibold">Mainboard</h2>
          <span className="text-xs bg-mtg-card px-2 py-0.5 rounded-full text-gray-400">
            {mainFiltered.reduce((s, c) => s + c.quantity, 0)} cards
          </span>
          {tagFilter && (
            <div className="flex items-center gap-1.5 ml-1">
              <span className="text-xs text-gray-500">tag:</span>
              <span className="bg-blue-900/50 text-blue-300 text-xs px-2 py-0.5 rounded-full">{tagFilter}</span>
              <button onClick={() => { setTagFilter(null); setSelectedIndex(null) }} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
            </div>
          )}
        </div>

        {mainboard.length === 0 ? (
          <div className="text-center text-gray-600 py-8 text-sm">No cards yet — search above or paste a list</div>
        ) : mainFiltered.length === 0 ? (
          <div className="text-center text-gray-600 py-4 text-sm">No cards match this tag filter</div>
        ) : (
          <BoardSection
            groups={mainGroups}
            board="mainboard"
            selectedBoard={selectedBoard}
            selectedIndex={selectedIndex}
            onSelect={idx => { setSelectedBoard('mainboard'); setSelectedIndex(idx) }}
            onDoubleClick={openEdit}
            onRemove={card => removeMutation.mutate({ oracleId: card.oracle_id, board: 'mainboard' })}
            onMove={card => moveMutation.mutate({ oracleId: card.oracle_id, fromBoard: 'mainboard', toBoard: 'maybeboard' })}
            containerRef={mainContainerRef}
          />
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
            ) : maybeFiltered.length === 0 ? (
              <div className="text-xs text-gray-600 py-2">No cards match this tag filter</div>
            ) : (
              <BoardSection
                groups={maybeGroups}
                board="maybeboard"
                selectedBoard={selectedBoard}
                selectedIndex={selectedIndex}
                onSelect={idx => { setSelectedBoard('maybeboard'); setSelectedIndex(idx) }}
                onDoubleClick={openEdit}
                onRemove={card => removeMutation.mutate({ oracleId: card.oracle_id, board: 'maybeboard' })}
                onMove={card => moveMutation.mutate({ oracleId: card.oracle_id, fromBoard: 'maybeboard', toBoard: 'mainboard' })}
                containerRef={maybeContainerRef}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
