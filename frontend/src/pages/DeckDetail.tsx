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
import FlippableCardImage from '../components/FlippableCardImage'

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

function mergeGroupLabels(main: AnnotatedGroup[], maybe: AnnotatedGroup[]): string[] {
  const mainLabels = main.map(g => g.label)
  const seen = new Set(mainLabels)
  return [...mainLabels, ...maybe.map(g => g.label).filter(l => !seen.has(l))]
}

// ── Mana pie charts ───────────────────────────────────────────────────────────
const MANA_COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const
type ManaColor = typeof MANA_COLORS[number]

const MANA_COLOR_STYLE: Record<ManaColor, { bg: string; label: string }> = {
  W: { bg: '#f5e8a3', label: 'White' },
  U: { bg: '#4a90d9', label: 'Blue'  },
  B: { bg: '#7c6f8e', label: 'Black' },
  R: { bg: '#e94560', label: 'Red'   },
  G: { bg: '#3a9e5f', label: 'Green' },
  C: { bg: '#9ca3af', label: 'Colorless' },
}

/** Extract colored/colorless mana symbols from a mana cost string (handles " // " MDFCs). */
function extractManaSymbols(manaCost: string | undefined): Partial<Record<ManaColor, number>> {
  const counts: Partial<Record<ManaColor, number>> = {}
  if (!manaCost) return counts
  for (const part of manaCost.split(' // ')) {
    for (const match of part.matchAll(/\{([^}]+)\}/g)) {
      const inner = match[1]
      for (const sym of MANA_COLORS) {
        // exact match OR present in a hybrid symbol like W/U or 2/W or W/P
        if (inner === sym || inner.split('/').includes(sym)) {
          counts[sym] = (counts[sym] ?? 0) + 1
        }
      }
    }
  }
  return counts
}

/** Parse oracle text to determine which mana colors a land can produce. */
function parseLandProduction(oracleText: string | undefined): ManaColor[] {
  if (!oracleText) return []
  // "any color" → all five colors
  if (/any color/i.test(oracleText)) return ['W', 'U', 'B', 'R', 'G']
  const produced = new Set<ManaColor>()
  // Find sentences/lines containing "Add" and extract color symbols from them
  for (const sentence of oracleText.split(/\n|(?<=\.)\s+/)) {
    if (!/\bAdd\b/i.test(sentence)) continue
    for (const match of sentence.matchAll(/\{([WUBRGC])\}/g)) {
      produced.add(match[1] as ManaColor)
    }
  }
  return [...produced]
}

/** SVG pie chart. Each slice is {color, count}. */
function PieChart({ slices, size = 80 }: {
  slices: { color: ManaColor; count: number }[]
  size?: number
}) {
  const total = slices.reduce((s, sl) => s + sl.count, 0)
  if (total === 0) return <div style={{ width: size, height: size }} className="rounded-full bg-gray-700/40" />

  const r = size / 2
  const paths: { d: string; fill: string; title: string }[] = []
  let angle = -Math.PI / 2 // start at 12 o'clock

  for (const sl of slices) {
    if (sl.count === 0) continue
    const sweep = (sl.count / total) * 2 * Math.PI
    const x1 = r + r * Math.cos(angle)
    const y1 = r + r * Math.sin(angle)
    angle += sweep
    const x2 = r + r * Math.cos(angle)
    const y2 = r + r * Math.sin(angle)
    const large = sweep > Math.PI ? 1 : 0
    paths.push({
      d: `M${r},${r} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`,
      fill: MANA_COLOR_STYLE[sl.color].bg,
      title: `${MANA_COLOR_STYLE[sl.color].label}: ${sl.count}`,
    })
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill} opacity={0.85}>
          <title>{p.title}</title>
        </path>
      ))}
    </svg>
  )
}

function ManaSymbolPie({ cards, commander }: { cards: DeckCard[]; commander?: DeckCard }) {
  const all = commander ? [...cards, commander] : cards
  const spells = all.filter(c => !c.type_line?.toLowerCase().includes('land'))

  const totals: Partial<Record<ManaColor, number>> = {}
  for (const card of spells) {
    const syms = extractManaSymbols(card.mana_cost)
    for (const [sym, n] of Object.entries(syms) as [ManaColor, number][]) {
      totals[sym] = (totals[sym] ?? 0) + n * card.quantity
    }
  }

  const total = Object.values(totals).reduce((s, n) => s + n, 0)
  const slices = MANA_COLORS.filter(c => totals[c]).map(c => ({ color: c, count: totals[c]! }))

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-xs text-gray-500">Mana Symbols <span className="text-gray-600">({total})</span></div>
      <PieChart slices={slices} />
      <div className="flex flex-wrap justify-center gap-x-2 gap-y-0.5">
        {slices.map(sl => (
          <span key={sl.color} className="flex items-center gap-1 text-[10px] text-gray-400">
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: MANA_COLOR_STYLE[sl.color].bg, opacity: 0.85 }} />
            {sl.count}{sl.color}
          </span>
        ))}
      </div>
    </div>
  )
}

function LandProductionPie({ cards }: { cards: DeckCard[] }) {
  const lands = cards.filter(c => c.type_line?.toLowerCase().includes('land'))

  const totals: Partial<Record<ManaColor, number>> = {}
  for (const land of lands) {
    const produced = parseLandProduction(land.oracle_text)
    for (const color of produced) {
      totals[color] = (totals[color] ?? 0) + land.quantity
    }
  }

  const landCount = lands.reduce((s, c) => s + c.quantity, 0)
  const slices = MANA_COLORS.filter(c => totals[c]).map(c => ({ color: c, count: totals[c]! }))

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-xs text-gray-500">Land Production <span className="text-gray-600">({landCount} lands)</span></div>
      <PieChart slices={slices} />
      <div className="flex flex-wrap justify-center gap-x-2 gap-y-0.5">
        {slices.map(sl => (
          <span key={sl.color} className="flex items-center gap-1 text-[10px] text-gray-400">
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: MANA_COLOR_STYLE[sl.color].bg, opacity: 0.85 }} />
            {sl.count}{sl.color}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Mana curve histogram ──────────────────────────────────────────────────────
const CMC_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7+']

function ManaCurve({ cards, commander }: { cards: DeckCard[]; commander?: DeckCard }) {
  const all = commander ? [...cards, commander] : cards
  const spells = all.filter(c => !c.type_line?.toLowerCase().includes('land'))

  const isNonPermanent = (c: DeckCard) =>
    c.type_line?.includes('Instant') || c.type_line?.includes('Sorcery')

  const permCounts = Object.fromEntries(CMC_LABELS.map(l => [l, 0]))
  const nonPermCounts = Object.fromEntries(CMC_LABELS.map(l => [l, 0]))

  for (const card of spells) {
    const cmc = Math.floor(card.cmc ?? 0)
    const key = cmc >= 7 ? '7+' : String(cmc)
    if (isNonPermanent(card)) nonPermCounts[key] += card.quantity
    else permCounts[key] += card.quantity
  }

  const totals = CMC_LABELS.map(l => permCounts[l] + nonPermCounts[l])
  const maxCount = Math.max(...totals, 1)
  const total = totals.reduce((s, c) => s + c, 0)
  const avgCmc = total === 0 ? 0 : spells.reduce((s, c) => s + (c.cmc ?? 0) * c.quantity, 0) / total

  return (
    <div className="flex flex-col flex-1 min-w-0">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs text-gray-500">
          Mana Curve <span className="text-gray-600">({total} spells · avg {avgCmc.toFixed(2)})</span>
        </span>
        <div className="flex items-center gap-2 ml-auto">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm inline-block bg-mtg-accent opacity-85" />
            <span className="text-[10px] text-gray-600">Permanent</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm inline-block bg-mtg-gold opacity-85" />
            <span className="text-[10px] text-gray-600">Non-permanent</span>
          </span>
        </div>
      </div>
      <div className="h-20 flex items-stretch gap-1">
        {CMC_LABELS.map((label, i) => {
          const perm = permCounts[label]
          const nonPerm = nonPermCounts[label]
          const total = totals[i]
          const pct = (total / maxCount) * 100
          return (
            <div key={label} className="flex flex-col items-center justify-end flex-1 min-w-0">
              {total > 0 && (
                <div className="text-[10px] text-gray-400 mb-0.5 leading-none">{total}</div>
              )}
              <div
                className="w-full flex flex-col overflow-hidden rounded-t-sm"
                style={{ height: total === 0 ? '1px' : `${Math.max(pct, 5)}%`, opacity: total === 0 ? 0.15 : 0.85 }}
                title={`CMC ${label}: ${perm} permanent${perm !== 1 ? 's' : ''}, ${nonPerm} non-permanent${nonPerm !== 1 ? 's' : ''}`}
              >
                {nonPerm > 0 && <div style={{ flex: nonPerm }} className="bg-mtg-gold" />}
                {perm > 0 && <div style={{ flex: perm }} className="bg-mtg-accent" />}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex gap-1 mt-1">
        {CMC_LABELS.map(label => (
          <div key={label} className="flex-1 text-center text-[10px] text-gray-600">{label}</div>
        ))}
      </div>
    </div>
  )
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
      data-board={board}
      className={`cursor-pointer rounded-lg ${selected ? 'ring-2 ring-blue-400' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <div className="relative group">
        <FlippableCardImage
          front={card.image_uri}
          back={card.image_uri_back}
          alt={card.name}
        />
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

  const boardAreaRef = useRef<HTMLDivElement | null>(null)
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

      // 'm' toggles the maybeboard tray
      if (e.key.toLowerCase() === 'm' && !editModal && !addPicker && !commanderPicker) {
        e.preventDefault()
        setShowMaybe(v => !v)
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
          const container = boardAreaRef.current
          if (!container || cur < 0) {
            next = 0
          } else {
            const allTiles = Array.from(container.querySelectorAll(`[data-board="${selectedBoard}"][data-card-index]`)) as HTMLElement[]
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
    const el = boardAreaRef.current?.querySelector(`[data-board="${selectedBoard}"][data-card-index="${selectedIndex}"]`) as HTMLElement | undefined
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
            <div className="space-y-1 min-w-0 shrink-0">
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
            <div className="flex flex-col flex-1 min-w-0 gap-4">
              <ManaCurve cards={mainboard} commander={commander} />
              <div className="flex gap-6 justify-around">
                <ManaSymbolPie cards={mainboard} commander={commander} />
                <LandProductionPie cards={mainboard} />
              </div>
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

      {/* ── Board area ── */}
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
          {showMaybe && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Maybeboard</span>
              <span className="text-xs bg-mtg-card px-2 py-0.5 rounded-full text-gray-400">
                {maybeFiltered.reduce((s, c) => s + c.quantity, 0)} cards
              </span>
            </div>
          )}
        </div>

        {mainboard.length === 0 && maybeboard.length === 0 ? (
          <div className="text-center text-gray-600 py-8 text-sm">No cards yet — search above or paste a list</div>
        ) : mainFiltered.length === 0 && maybeFiltered.length === 0 ? (
          <div className="text-center text-gray-600 py-4 text-sm">No cards match this tag filter</div>
        ) : (
          <div ref={boardAreaRef} className="space-y-6">
            {mergeGroupLabels(mainGroups, maybeGroups).map(label => {
              const mainSection = mainGroups.find(g => g.label === label)
              const maybeSection = maybeGroups.find(g => g.label === label)
              if (!mainSection?.cards.length && !maybeSection?.cards.length) return null
              const showLabel = label !== ''
              const mainCount = mainSection?.cards.reduce((s, c) => s + c.card.quantity, 0) ?? 0
              const maybeCount = maybeSection?.cards.reduce((s, c) => s + c.card.quantity, 0) ?? 0
              return (
                <div key={label || '__flat__'} className="flex items-stretch">
                  {/* Main column */}
                  <div className="flex-1 min-w-0">
                    {showLabel && mainCount > 0 && (
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
                        <span className="text-xs text-gray-600">{mainCount}</span>
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px' }}>
                      {mainSection?.cards.map(({ card, seqIdx }) => (
                        <DeckCardTile
                          key={`main-${label}-${card.id}`}
                          card={card}
                          board="mainboard"
                          navIndex={seqIdx}
                          selected={selectedBoard === 'mainboard' && selectedIndex === seqIdx}
                          onClick={() => { setSelectedBoard('mainboard'); setSelectedIndex(seqIdx) }}
                          onDoubleClick={() => openEdit(card)}
                          onRemove={() => removeMutation.mutate({ oracleId: card.oracle_id, board: 'mainboard' })}
                          onMove={() => moveMutation.mutate({ oracleId: card.oracle_id, fromBoard: 'mainboard', toBoard: 'maybeboard' })}
                        />
                      ))}
                    </div>
                  </div>
                  {/* Vertical divider — animates with maybe column */}
                  <div
                    style={{
                      flexShrink: 0,
                      width: showMaybe ? '1px' : '0',
                      margin: showMaybe ? '0 12px' : '0',
                      alignSelf: 'stretch',
                      backgroundColor: 'rgba(75, 85, 99, 0.4)',
                      transition: 'width 0.3s ease, margin 0.3s ease',
                    }}
                  />
                  {/* Maybeboard column — slides in from right */}
                  <div
                    style={{
                      width: showMaybe ? '32%' : '0',
                      flexShrink: 0,
                      overflow: 'hidden',
                      transition: 'width 0.3s ease',
                    }}
                  >
                    {showLabel && maybeCount > 0 && (
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</span>
                        <span className="text-xs text-gray-700">{maybeCount}</span>
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px' }}>
                      {maybeSection?.cards.map(({ card, seqIdx }) => (
                        <DeckCardTile
                          key={`maybe-${label}-${card.id}`}
                          card={card}
                          board="maybeboard"
                          navIndex={seqIdx}
                          selected={selectedBoard === 'maybeboard' && selectedIndex === seqIdx}
                          onClick={() => { setSelectedBoard('maybeboard'); setSelectedIndex(seqIdx) }}
                          onDoubleClick={() => openEdit(card)}
                          onRemove={() => removeMutation.mutate({ oracleId: card.oracle_id, board: 'maybeboard' })}
                          onMove={() => moveMutation.mutate({ oracleId: card.oracle_id, fromBoard: 'maybeboard', toBoard: 'mainboard' })}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Fixed tab: Maybeboard toggle */}
      <button
        onClick={() => setShowMaybe(v => !v)}
        style={{
          position: 'fixed',
          right: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          writingMode: 'vertical-lr',
          zIndex: 30,
        }}
        className={`border border-r-0 text-xs px-2 py-4 rounded-l-lg transition-colors shadow-lg
          ${showMaybe
            ? 'bg-mtg-accent/20 border-mtg-accent/50 text-mtg-accent'
            : 'bg-mtg-surface border-gray-700 text-gray-400 hover:text-white hover:bg-mtg-card'
          }`}
      >
        Maybeboard ({maybeboard.reduce((s, c) => s + c.quantity, 0)})
      </button>
    </div>
  )
}
