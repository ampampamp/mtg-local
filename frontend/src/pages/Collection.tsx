import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCollection, deleteCollectionCard, importCollection, searchCards } from '../api'
import type { CollectionEntry, ScryfallCard } from '../types'
import CardAutocomplete from '../components/CardAutocomplete'
import AddToCollectionModal from '../components/AddToCollectionModal'
import PrintingPickerModal from '../components/PrintingPickerModal'

const PAGE_SIZE = 60

function entryToCard(entry: CollectionEntry): ScryfallCard {
  return {
    id: entry.scryfall_id,
    oracle_id: entry.oracle_id,
    name: entry.name,
    set: entry.set_code,
    set_name: entry.set_name,
    collector_number: entry.collector_number,
    image_uri: entry.image_uri,
    prices: entry.prices,
    scryfall_uri: entry.scryfall_uri,
    related_uris: entry.related_uris,
    purchase_uris: entry.purchase_uris,
  }
}

interface TileProps {
  card: CollectionEntry
  index: number
  selected: boolean
  onClick: () => void
  onDoubleClick: () => void
}

function CollectionTile({ card, index, selected, onClick, onDoubleClick }: TileProps) {
  const deckCount = card._ownership?.decks?.length ?? 0
  const deckTitle = card._ownership?.decks?.map(d => `${d.deck_name} ×${d.quantity}`).join(', ')
  return (
    <div
      data-card-index={index}
      className={`bg-mtg-card rounded-lg overflow-hidden cursor-pointer transition-all
        ${selected
          ? 'ring-2 ring-blue-400'
          : 'hover:ring-2 hover:ring-blue-500'
        }`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {card.image_uri ? (
        <img src={card.image_uri} alt={card.name} className="w-full" loading="lazy" />
      ) : (
        <div className="aspect-[2.5/3.5] bg-mtg-surface flex items-center justify-center text-gray-600 text-xs px-2 text-center">
          {card.name}
        </div>
      )}
      <div className="p-2 text-xs">
        <div className="flex items-center justify-between gap-1">
          <span className="font-medium flex items-center gap-1.5">
            {card.quantity > 0 ? `${card.quantity}` : ''}
            {card.quantity > 0 && card.foil_quantity > 0 ? ' + ' : ''}
            {card.foil_quantity > 0 ? `${card.foil_quantity}✨` : ''}
            {deckCount > 0 ? (
              <span className="text-blue-400 font-normal" title={deckTitle}>
                · {deckCount}d
              </span>
            ) : (
              <span className="text-gray-600 font-normal">—</span>
            )}
          </span>
          {card.prices?.usd && (
            <span className="text-mtg-gold">${card.prices.usd}</span>
          )}
        </div>
      </div>
    </div>
  )
}

interface ModalState {
  card: ScryfallCard
  initialQty: number
  initialFoilQty: number
  isExisting: boolean
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-3 pt-2">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="btn-secondary text-sm disabled:opacity-30"
      >
        ← Prev
      </button>
      <span className="text-sm text-gray-400">Page {page} of {totalPages}</span>
      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className="btn-secondary text-sm disabled:opacity-30"
      >
        Next →
      </button>
    </div>
  )
}

export default function CollectionPage() {
  const qc = useQueryClient()
  const [view, setView] = useState<'list' | 'gallery'>('gallery')
  const [modal, setModal] = useState<ModalState | null>(null)
  const [printingPicker, setPrintingPicker] = useState<{ oracleId: string; cardName: string } | null>(null)
  const [page, setPage] = useState(1)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  // Import panel state
  const [importOpen, setImportOpen] = useState(false)
  const [importCsv, setImportCsv] = useState('')
  const [importFileName, setImportFileName] = useState<string | null>(null)
  const [importRowCount, setImportRowCount] = useState<number | null>(null)
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append')
  const [importResult, setImportResult] = useState<{ imported: number; failed: { row: string; reason: string }[] } | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Scryfall filter state
  const [filterInput, setFilterInput] = useState('')
  const [filterIds, setFilterIds] = useState<Set<string> | null>(null) // scryfall_ids
  const [filterLoading, setFilterLoading] = useState(false)
  const [filterLoadingMore, setFilterLoadingMore] = useState(false)
  const filterQueryId = useRef(0)

  const gridRef = useRef<HTMLDivElement>(null)
  const addFocusRef = useRef<(() => void) | null>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery({ queryKey: ['collection'], queryFn: getCollection })

  const removeMutation = useMutation({
    mutationFn: (sid: string) => deleteCollectionCard(sid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection'] }),
  })

  const cards: CollectionEntry[] = data?.data ?? []

  const filtered = filterIds
    ? cards.filter(c => filterIds.has(c.scryfall_id))
    : cards

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedCards = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // Keep a ref with current values to avoid stale closures in the keydown handler
  const handlerRef = useRef({ selectedIndex, pagedCards, view, modal, printingPicker })
  handlerRef.current = { selectedIndex, pagedCards, view, modal, printingPicker }

  // Reset page + selection when view changes (filter resets page explicitly in applyFilter/clearFilter)
  useEffect(() => { setPage(1); setSelectedIndex(null) }, [view])

  const openModalForEntry = useCallback((entry: CollectionEntry) => {
    setModal({
      card: entryToCard(entry),
      initialQty: entry.quantity,
      initialFoilQty: entry.foil_quantity,
      isExisting: true,
    })
  }, [])

  // Global keydown handler — attached once, reads current state via ref
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const { selectedIndex, pagedCards, view, modal, printingPicker } = handlerRef.current
      const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase()
      const inInput = tag === 'input' || tag === 'textarea' || tag === 'select'

      // Escape: blur any focused input, close modal, close printing picker, then deselect
      if (e.key === 'Escape') {
        ;(document.activeElement as HTMLElement)?.blur()
        if (modal) {
          setModal(null)
        } else if (printingPicker) {
          setPrintingPicker(null)
        } else {
          setSelectedIndex(null)
        }
        return
      }

      if (inInput) return

      // a → focus add-card input, f → focus filter input
      if (e.key.toLowerCase() === 'a' && !modal && !printingPicker) {
        e.preventDefault()
        setSelectedIndex(null)
        addFocusRef.current?.()
        return
      }
      if (e.key.toLowerCase() === 'f' && !modal && !printingPicker) {
        e.preventDefault()
        setSelectedIndex(null)
        filterInputRef.current?.focus()
        return
      }

      // Enter opens modal for selected card
      if (e.key === 'Enter' && selectedIndex !== null && !modal && !printingPicker) {
        e.preventDefault()
        const entry = pagedCards[selectedIndex]
        if (entry) openModalForEntry(entry)
        return
      }

      // Arrow key navigation
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && !modal && !printingPicker) {
        if (pagedCards.length === 0) return
        e.preventDefault()

        const total = pagedCards.length
        const current = selectedIndex ?? -1
        let next = current

        if (view === 'list') {
          if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            next = current <= 0 ? 0 : current - 1
          } else {
            next = current < 0 ? 0 : Math.min(total - 1, current + 1)
          }
        } else {
          // Gallery: 2D navigation — measure column count from the live grid
          let cols = 1
          if (gridRef.current) {
            const colStr = getComputedStyle(gridRef.current).gridTemplateColumns
            cols = colStr.split(' ').filter(Boolean).length
          }
          if (e.key === 'ArrowLeft') next = current <= 0 ? 0 : current - 1
          else if (e.key === 'ArrowRight') next = current < 0 ? 0 : Math.min(total - 1, current + 1)
          else if (e.key === 'ArrowUp') next = current - cols < 0 ? (current < 0 ? 0 : current) : current - cols
          else if (e.key === 'ArrowDown') next = current < 0 ? 0 : Math.min(total - 1, current + cols)
        }

        setSelectedIndex(next)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openModalForEntry]) // openModalForEntry is stable via useCallback

  // Scroll selected card into view when navigating with keys
  useEffect(() => {
    if (selectedIndex === null) return
    const el = document.querySelector(`[data-card-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedIndex])

  const totalCards = cards.reduce((s, c) => s + c.quantity + c.foil_quantity, 0)
  const totalValue = cards.reduce((s, c) => {
    const price = parseFloat(c.prices?.usd ?? '0')
    const foilPrice = parseFloat(c.prices?.usd_foil ?? '0')
    return s + price * c.quantity + foilPrice * c.foil_quantity
  }, 0)

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      setImportCsv(text)
      setImportFileName(file.name)
      const rows = text.split('\n').filter(l => l.trim()).length - 1
      setImportRowCount(Math.max(0, rows))
    }
    reader.readAsText(file)
  }

  function clearFileSelection() {
    setImportFileName(null)
    setImportRowCount(null)
    setImportCsv('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleImport() {
    if (!importCsv.trim()) return
    setImporting(true)
    setImportResult(null)
    try {
      const result = await importCollection(importCsv, importMode)
      setImportResult(result)
      qc.invalidateQueries({ queryKey: ['collection'] })
    } catch {
      setImportResult({ imported: 0, failed: [{ row: '', reason: 'Import failed. Check CSV format.' }] })
    } finally {
      setImporting(false)
    }
  }

  async function applyFilter() {
    if (!filterInput.trim()) { clearFilter(); return }

    const queryId = ++filterQueryId.current
    const query = filterInput.trim()
    setFilterLoading(true)

    try {
      const first = await searchCards(query, 1)
      if (queryId !== filterQueryId.current) return

      const allIds = new Set<string>()
      ;(first.data ?? []).forEach((c: ScryfallCard) => { if (c.id) allIds.add(c.id) })
      setFilterIds(new Set(allIds))
      setPage(1)
      setSelectedIndex(null)
      setFilterLoading(false)

      if (!first.has_more) return

      // Eagerly fetch pages 2–5 in the background
      setFilterLoadingMore(true)
      for (let p = 2; p <= 5; p++) {
        if (queryId !== filterQueryId.current) break
        try {
          const result = await searchCards(query, p)
          if (queryId !== filterQueryId.current) break
          ;(result.data ?? []).forEach((c: ScryfallCard) => { if (c.id) allIds.add(c.id) })
          setFilterIds(new Set(allIds))
          if (!result.has_more) break
        } catch {
          break
        }
      }
      if (queryId === filterQueryId.current) setFilterLoadingMore(false)
    } catch {
      if (queryId === filterQueryId.current) setFilterLoading(false)
    }
  }

  function clearFilter() {
    filterQueryId.current++
    setFilterInput('')
    setFilterIds(null)
    setFilterLoadingMore(false)
    setPage(1)
    setSelectedIndex(null)
  }

  function handlePageChange(p: number) {
    setPage(p)
    setSelectedIndex(null)
  }

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold">My Collection</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-sm text-gray-400">
            {totalCards} cards · ~${totalValue.toFixed(2)}
          </div>
          <div className="flex rounded border border-gray-700 overflow-hidden">
            <button
              className={`px-3 py-1 text-sm ${view === 'gallery' ? 'bg-mtg-surface text-white' : 'text-gray-400 hover:text-white'}`}
              onClick={() => setView('gallery')}
            >
              Gallery
            </button>
            <button
              className={`px-3 py-1 text-sm border-l border-gray-700 ${view === 'list' ? 'bg-mtg-surface text-white' : 'text-gray-400 hover:text-white'}`}
              onClick={() => setView('list')}
            >
              List
            </button>
          </div>
          <button
            className="btn-secondary text-sm"
            onClick={() => { setImportOpen(o => !o); setImportResult(null) }}
          >
            ⬆ Import CSV
          </button>
        </div>
      </div>

      {/* Import panel */}
      {importOpen && (
        <div className="bg-mtg-surface rounded-xl p-4 space-y-3 border border-gray-700">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Import Moxfield CSV</div>
            <button onClick={() => setImportOpen(false)} className="text-gray-500 hover:text-gray-300 text-xs">
              ✕ Close
            </button>
          </div>

          {importFileName ? (
            <div className="flex items-center gap-3 px-3 py-2 bg-mtg-card rounded border border-gray-600">
              <span className="text-sm text-gray-200 flex-1 truncate">{importFileName}</span>
              {importRowCount !== null && (
                <span className="text-xs text-gray-400 shrink-0">{importRowCount} rows</span>
              )}
              <button onClick={clearFileSelection} className="text-gray-500 hover:text-gray-300 text-xs shrink-0">
                ✕ Clear
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <button
                  className="btn-secondary text-sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose file
                </button>
                <span className="text-xs text-gray-500">or paste below</span>
              </div>
              <textarea
                className="input w-full h-32 font-mono text-xs resize-y"
                placeholder="Paste Moxfield CSV export here..."
                value={importCsv}
                onChange={e => setImportCsv(e.target.value)}
              />
            </div>
          )}

          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex rounded border border-gray-700 overflow-hidden">
              <button
                className={`px-3 py-1 text-sm ${importMode === 'append' ? 'bg-blue-700 text-white' : 'text-gray-400 hover:text-white'}`}
                onClick={() => setImportMode('append')}
              >
                Append
              </button>
              <button
                className={`px-3 py-1 text-sm border-l border-gray-700 ${importMode === 'replace' ? 'bg-red-700 text-white' : 'text-gray-400 hover:text-white'}`}
                onClick={() => setImportMode('replace')}
              >
                Replace
              </button>
            </div>
            <span className="text-xs text-gray-500">
              {importMode === 'append' ? 'Adds to existing quantities' : 'Replaces all collection data'}
            </span>
            <button
              onClick={handleImport}
              disabled={importing || !importCsv.trim()}
              className="btn-primary ml-auto"
            >
              {importing ? 'Importing...' : 'Import'}
            </button>
          </div>
          {importResult && (
            <div className="text-sm space-y-1">
              <div className={importResult.imported > 0 ? 'text-green-400' : 'text-gray-400'}>
                {importResult.imported} cards imported
              </div>
              {importResult.failed.length > 0 && (
                <details>
                  <summary className="text-yellow-400 cursor-pointer">
                    {importResult.failed.length} rows failed
                  </summary>
                  <ul className="mt-1 text-xs text-gray-500 space-y-0.5 max-h-32 overflow-y-auto">
                    {importResult.failed.map((f, i) => (
                      <li key={i}>{f.row}{f.row ? ': ' : ''}{f.reason}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add card + Scryfall filter — side by side */}
      <div className="flex gap-3 items-start flex-wrap">
        <div className="flex-1 min-w-56">
          <CardAutocomplete
            placeholder="Add card to collection... (a)"
            clearOnSelect
            focusRef={addFocusRef}
            onFocus={() => setSelectedIndex(null)}
            onSelect={card => setPrintingPicker({ oracleId: card.oracle_id, cardName: card.name })}
          />
        </div>

        <div className="flex-1 min-w-56 flex gap-2 items-center">
          <input
            ref={filterInputRef}
            className={`input flex-1 transition-opacity ${filterLoading ? 'opacity-50' : ''}`}
            placeholder="Filter: t:creature c:red... (f)"
            value={filterInput}
            onChange={e => setFilterInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyFilter() }}
            onFocus={() => setSelectedIndex(null)}
            disabled={filterLoading}
          />
          {filterIds !== null && !filterLoading ? (
            <button onClick={clearFilter} className="btn-secondary text-sm shrink-0" title="Clear filter">
              ✕
            </button>
          ) : (
            <button onClick={applyFilter} disabled={filterLoading} className="btn-secondary text-sm shrink-0 flex items-center gap-1.5">
              {filterLoading && (
                <svg className="animate-spin h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              )}
              {filterLoading ? 'Filtering...' : 'Filter'}
            </button>
          )}
        </div>
      </div>

      {/* Filter status */}
      {filterIds !== null && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>Showing {filtered.length} of {cards.length} owned cards</span>
          {filterLoadingMore && (
            <svg className="animate-spin h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
        </div>
      )}

      {isLoading && <div className="text-gray-400">Loading collection...</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center text-gray-600 mt-16">
          <div className="text-4xl mb-2">📦</div>
          <div className="text-lg">{filterIds !== null ? 'No matching cards in collection' : 'Your collection is empty'}</div>
          <div className="text-sm mt-1">
            {filterIds !== null ? 'Try a different filter or clear it' : 'Search for cards above or import a Moxfield CSV'}
          </div>
        </div>
      )}

      {/* List view */}
      {view === 'list' && pagedCards.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="pb-2 pr-4">Card</th>
                  <th className="pb-2 pr-4">Set</th>
                  <th className="pb-2 pr-4">Qty</th>
                  <th className="pb-2 pr-4">Price</th>
                  <th className="pb-2 pr-4">Usage</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {pagedCards.map((card, i) => {
                  const deckCount = card._ownership?.decks?.length ?? 0
                  const deckTitle = card._ownership?.decks?.map(d => `${d.deck_name} ×${d.quantity}`).join(', ')
                  const isSelected = selectedIndex === i
                  return (
                    <tr
                      key={card.id}
                      data-card-index={i}
                      className={`cursor-pointer transition-colors ${isSelected ? 'bg-blue-950/60' : 'hover:bg-mtg-surface/50'}`}
                      onClick={() => setSelectedIndex(i)}
                      onDoubleClick={() => openModalForEntry(card)}
                    >
                      <td className="py-2 pr-4 font-medium">{card.name}</td>
                      <td className="py-2 pr-4 text-gray-400">
                        {card.set_code?.toUpperCase()} #{card.collector_number}
                      </td>
                      <td className="py-2 pr-4">
                        {card.quantity > 0 ? `${card.quantity}` : ''}
                        {card.quantity > 0 && card.foil_quantity > 0 ? ' + ' : ''}
                        {card.foil_quantity > 0 ? `${card.foil_quantity}✨` : ''}
                      </td>
                      <td className="py-2 pr-4 text-mtg-gold">
                        {card.prices?.usd ? `$${card.prices.usd}` : '—'}
                      </td>
                      <td className="py-2 pr-4" title={deckTitle}>
                        {deckCount > 0 ? (
                          <span className="text-blue-400 cursor-default">
                            {deckCount} deck{deckCount !== 1 ? 's' : ''}
                          </span>
                        ) : <span className="text-gray-700">—</span>}
                      </td>
                      <td className="py-2">
                        <button
                          onClick={e => { e.stopPropagation(); removeMutation.mutate(card.scryfall_id) }}
                          className="text-xs text-gray-600 hover:text-red-400 transition-colors"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={safePage} totalPages={totalPages} onChange={handlePageChange} />
        </>
      )}

      {/* Gallery view */}
      {view === 'gallery' && pagedCards.length > 0 && (
        <>
          <div
            ref={gridRef}
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3"
          >
            {pagedCards.map((card, i) => (
              <CollectionTile
                key={card.id}
                card={card}
                index={i}
                selected={selectedIndex === i}
                onClick={() => setSelectedIndex(i)}
                onDoubleClick={() => openModalForEntry(card)}
              />
            ))}
          </div>
          <Pagination page={safePage} totalPages={totalPages} onChange={handlePageChange} />
        </>
      )}

      {printingPicker && (
        <PrintingPickerModal
          oracle_id={printingPicker.oracleId}
          cardName={printingPicker.cardName}
          onClose={() => setPrintingPicker(null)}
          onSelect={card => {
            setPrintingPicker(null)
            setModal({ card, initialQty: 1, initialFoilQty: 0, isExisting: false })
          }}
        />
      )}

      {modal && (
        <AddToCollectionModal
          card={modal.card}
          initialQty={modal.initialQty}
          initialFoilQty={modal.initialFoilQty}
          isExisting={modal.isExisting}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
