import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCollection, deleteCollectionCard, importCollection, searchCards } from '../api'
import type { CollectionEntry, ScryfallCard } from '../types'
import CardAutocomplete from '../components/CardAutocomplete'
import AddToCollectionModal from '../components/AddToCollectionModal'

function entryToCard(entry: CollectionEntry): ScryfallCard {
  return {
    id: entry.scryfall_id,
    oracle_id: entry.oracle_id,
    name: entry.name,
    set: entry.set_code,
    set_name: entry.set_name,
    collector_number: entry.collector_number,
    prices: entry.prices,
  }
}

interface TileProps {
  card: CollectionEntry
  onClick: () => void
}

function CollectionTile({ card, onClick }: TileProps) {
  const deckCount = card._ownership?.decks?.length ?? 0
  const deckTitle = card._ownership?.decks?.map(d => `${d.deck_name} ×${d.quantity}`).join(', ')
  return (
    <div
      className="bg-mtg-card rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all"
      onClick={onClick}
    >
      {card.image_uri ? (
        <img src={card.image_uri} alt={card.name} className="w-full" loading="lazy" />
      ) : (
        <div className="aspect-[2.5/3.5] bg-mtg-surface flex items-center justify-center text-gray-600 text-xs px-2 text-center">
          {card.name}
        </div>
      )}
      <div className="p-2 space-y-1 text-xs">
        <div className="flex items-center justify-between gap-1">
          <span className="font-medium">
            {card.quantity > 0 ? `${card.quantity}` : ''}
            {card.quantity > 0 && card.foil_quantity > 0 ? ' + ' : ''}
            {card.foil_quantity > 0 ? `${card.foil_quantity}✨` : ''}
          </span>
          {card.prices?.usd && (
            <span className="text-mtg-gold">${card.prices.usd}</span>
          )}
        </div>
        {deckCount > 0 && (
          <div className="text-blue-400 cursor-default" title={deckTitle}>
            {deckCount} deck{deckCount !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  )
}

interface ModalState {
  card: ScryfallCard
  initialQty: number
  initialFoilQty: number
}

export default function CollectionPage() {
  const qc = useQueryClient()
  const [view, setView] = useState<'list' | 'gallery'>('list')
  const [modal, setModal] = useState<ModalState | null>(null)

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
  const [filterOracleIds, setFilterOracleIds] = useState<Set<string> | null>(null)
  const [filterLoading, setFilterLoading] = useState(false)
  const [filterTruncated, setFilterTruncated] = useState(false)

  const { data, isLoading } = useQuery({ queryKey: ['collection'], queryFn: getCollection })

  const removeMutation = useMutation({
    mutationFn: (sid: string) => deleteCollectionCard(sid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection'] }),
  })

  const cards: CollectionEntry[] = data?.data ?? []
  const filtered = filterOracleIds
    ? cards.filter(c => c.oracle_id && filterOracleIds.has(c.oracle_id))
    : cards

  const totalCards = cards.reduce((s, c) => s + c.quantity + c.foil_quantity, 0)
  const totalValue = cards.reduce((s, c) => {
    const price = parseFloat(c.prices?.usd ?? '0')
    const foilPrice = parseFloat(c.prices?.usd_foil ?? '0')
    return s + price * c.quantity + foilPrice * c.foil_quantity
  }, 0)

  function openModalForEntry(entry: CollectionEntry) {
    setModal({
      card: entryToCard(entry),
      initialQty: entry.quantity,
      initialFoilQty: entry.foil_quantity,
    })
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      setImportCsv(text)
      setImportFileName(file.name)
      // count data rows (total lines minus header)
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
    if (!filterInput.trim()) {
      clearFilter()
      return
    }
    setFilterLoading(true)
    setFilterTruncated(false)
    try {
      const result = await searchCards(filterInput.trim())
      const ids = new Set<string>((result.data ?? []).map((c: ScryfallCard) => c.oracle_id).filter(Boolean))
      setFilterOracleIds(ids)
      setFilterTruncated(!!result.has_more)
    } catch {
      // on error keep previous filter
    } finally {
      setFilterLoading(false)
    }
  }

  function clearFilter() {
    setFilterInput('')
    setFilterOracleIds(null)
    setFilterTruncated(false)
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
              className={`px-3 py-1 text-sm ${view === 'list' ? 'bg-mtg-surface text-white' : 'text-gray-400 hover:text-white'}`}
              onClick={() => setView('list')}
            >
              List
            </button>
            <button
              className={`px-3 py-1 text-sm border-l border-gray-700 ${view === 'gallery' ? 'bg-mtg-surface text-white' : 'text-gray-400 hover:text-white'}`}
              onClick={() => setView('gallery')}
            >
              Gallery
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

          {/* File picker or paste textarea */}
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
        {/* Add card */}
        <div className="flex-1 min-w-56">
          <CardAutocomplete
            placeholder="Add card to collection..."
            clearOnSelect
            onSelect={card => setModal({ card, initialQty: 1, initialFoilQty: 0 })}
          />
        </div>

        {/* Filter collection */}
        <div className="flex-1 min-w-56 flex gap-2 items-center">
          <input
            className="input flex-1"
            placeholder="Filter: t:creature c:red..."
            value={filterInput}
            onChange={e => setFilterInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyFilter() }}
          />
          {filterOracleIds !== null ? (
            <button
              onClick={clearFilter}
              className="btn-secondary text-sm shrink-0"
              title="Clear filter"
            >
              ✕
            </button>
          ) : (
            <button
              onClick={applyFilter}
              disabled={filterLoading}
              className="btn-secondary text-sm shrink-0"
            >
              {filterLoading ? '…' : 'Filter'}
            </button>
          )}
        </div>
      </div>

      {/* Filter warnings */}
      {filterTruncated && (
        <div className="text-xs text-yellow-400">
          Results truncated — refine your query
        </div>
      )}
      {filterOracleIds !== null && (
        <div className="text-xs text-gray-400">
          Showing {filtered.length} of {cards.length} owned cards
        </div>
      )}

      {isLoading && <div className="text-gray-400">Loading collection...</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center text-gray-600 mt-16">
          <div className="text-4xl mb-2">📦</div>
          <div className="text-lg">{filterOracleIds !== null ? 'No matching cards in collection' : 'Your collection is empty'}</div>
          <div className="text-sm mt-1">
            {filterOracleIds !== null ? 'Try a different filter or clear it' : 'Search for cards above or import a Moxfield CSV'}
          </div>
        </div>
      )}

      {/* List view */}
      {view === 'list' && filtered.length > 0 && (
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
              {filtered.map(card => {
                const deckCount = card._ownership?.decks?.length ?? 0
                const deckTitle = card._ownership?.decks?.map(d => `${d.deck_name} ×${d.quantity}`).join(', ')
                return (
                  <tr
                    key={card.id}
                    className="hover:bg-mtg-surface/50 cursor-pointer"
                    onClick={() => openModalForEntry(card)}
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
                      ) : '—'}
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
      )}

      {/* Gallery view */}
      {view === 'gallery' && filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {filtered.map(card => (
            <CollectionTile
              key={card.id}
              card={card}
              onClick={() => openModalForEntry(card)}
            />
          ))}
        </div>
      )}

      {modal && (
        <AddToCollectionModal
          card={modal.card}
          initialQty={modal.initialQty}
          initialFoilQty={modal.initialFoilQty}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
