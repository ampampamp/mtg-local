import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, Link } from 'react-router-dom'
import { getDecks, createDeck, deleteDeck, renameDeck } from '../api'
import type { Deck, ScryfallCard } from '../types'
import CardAutocomplete from '../components/CardAutocomplete'
import PrintingPickerModal from '../components/PrintingPickerModal'

function daysAgo(dateStr: string) {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
}

export default function DecksPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [commanderCard, setCommanderCard] = useState<ScryfallCard | null>(null)
  const [commanderPicker, setCommanderPicker] = useState<{ oracleId: string; cardName: string } | null>(null)
  const [importText, setImportText] = useState('')
  const [importFileName, setImportFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data } = useQuery({ queryKey: ['decks'], queryFn: getDecks })

  // Validate commander appears in decklist (only when a list is provided)
  const hasImport = !!(importText.trim() || importFileName)
  const commanderInList = !hasImport || !commanderCard ||
    importText.toLowerCase().includes(commanderCard.name.toLowerCase())
  const commanderError = hasImport && commanderCard && !commanderInList
    ? 'Commander not found in list'
    : null

  const createMutation = useMutation({
    mutationFn: () => createDeck({
      name: newName.trim(),
      format: 'commander',
      description: '',
      decklist: importText.trim(),
      commander_scryfall_id: commanderCard?.id ?? '',
    }),
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: ['decks'] })
      navigate(`/decks/${result.id}`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteDeck(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['decks'] }),
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => renameDeck(id, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['decks'] })
      setEditingId(null)
    },
  })

  function startEditing(deck: Deck) {
    setEditingId(deck.id)
    setEditingName(deck.name)
  }

  function commitRename() {
    if (!editingId || !editingName.trim()) { setEditingId(null); return }
    renameMutation.mutate({ id: editingId, name: editingName.trim() })
  }

  const decks: Deck[] = data?.data ?? []

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      setImportText(ev.target?.result as string)
      setImportFileName(file.name)
    }
    reader.readAsText(file)
  }

  function clearImport() {
    setImportText('')
    setImportFileName(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleCancel() {
    setCreating(false)
    setNewName('')
    setCommanderCard(null)
    setCommanderPicker(null)
    clearImport()
    createMutation.reset()
  }

  const canCreate = newName.trim() && commanderCard && !commanderError && !createMutation.isPending

  return (
    <div className="p-6 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Decks</h1>
        <button onClick={() => setCreating(true)} className="btn-primary">+ New Deck</button>
      </div>

      {creating && (
        <div className="bg-mtg-surface rounded-xl p-4 space-y-3 border border-gray-700">
          <h2 className="font-semibold">New Deck</h2>

          {/* Deck name */}
          <input
            className="input"
            placeholder="Deck name"
            value={newName}
            autoFocus
            onChange={e => setNewName(e.target.value)}
          />

          {/* Commander */}
          <div className="space-y-1">
            <label className="text-xs text-gray-400">Commander</label>
            {commanderCard ? (
              <div className="flex items-center gap-3 px-3 py-2 bg-mtg-card rounded border border-gray-600">
                {commanderCard.image_uri && (
                  <img src={commanderCard.image_uri} alt="" className="w-8 rounded flex-shrink-0" />
                )}
                <span className="text-sm flex-1 font-medium">{commanderCard.name}</span>
                <span className="text-xs text-gray-500 shrink-0">
                  {commanderCard.set?.toUpperCase()} #{commanderCard.collector_number}
                </span>
                <button
                  onClick={() => setCommanderCard(null)}
                  className="text-gray-500 hover:text-gray-300 text-xs shrink-0"
                >
                  ✕
                </button>
              </div>
            ) : (
              <CardAutocomplete
                placeholder="Search for commander..."
                onSelect={card => setCommanderPicker({ oracleId: card.oracle_id, cardName: card.name })}
                className=""
              />
            )}
          </div>

          {/* Decklist import */}
          {importFileName ? (
            <div className="flex items-center gap-3 px-3 py-2 bg-mtg-card rounded border border-gray-600">
              <span className="text-sm text-gray-200 flex-1 truncate">{importFileName}</span>
              <button onClick={clearImport} className="text-gray-500 hover:text-gray-300 text-xs shrink-0">
                ✕ Clear
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.dec"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <button className="btn-secondary text-sm" onClick={() => fileInputRef.current?.click()}>
                  Choose file
                </button>
                <span className="text-xs text-gray-500">or paste a decklist (optional)</span>
              </div>
              <textarea
                className="input w-full h-32 font-mono text-xs resize-y"
                placeholder={"1 Ramos, Dragon Engine (FDN) 678\n1 Lightning Bolt\n..."}
                value={importText}
                onChange={e => setImportText(e.target.value)}
              />
            </div>
          )}

          {commanderError && (
            <div className="text-red-400 text-xs">{commanderError}</div>
          )}
          {createMutation.isError && (
            <div className="text-red-400 text-xs">Failed to create deck. Check the decklist format.</div>
          )}

          <div className="flex gap-2">
            <button onClick={handleCancel} className="btn-secondary flex-1">Cancel</button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={!canCreate}
              className="btn-primary flex-1 disabled:opacity-40"
            >
              {createMutation.isPending
                ? 'Creating...'
                : hasImport
                  ? 'Create & Import'
                  : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Commander printing picker */}
      {commanderPicker && (
        <PrintingPickerModal
          oracle_id={commanderPicker.oracleId}
          cardName={commanderPicker.cardName}
          onSelect={printing => {
            setCommanderCard(printing)
            setCommanderPicker(null)
          }}
          onClose={() => setCommanderPicker(null)}
          hidePrices
        />
      )}

      {decks.length === 0 && !creating && (
        <div className="text-center text-gray-600 mt-16">
          <div className="text-4xl mb-2">🃏</div>
          <div className="text-lg">No decks yet</div>
          <div className="text-sm mt-1">Create your first deck to get started</div>
        </div>
      )}

      <div className="grid gap-3">
        {decks.map(deck => (
          <div
            key={deck.id}
            onDoubleClick={() => navigate(`/decks/${deck.id}`)}
            className="bg-mtg-surface rounded-xl p-4 flex items-center justify-between border border-gray-700/50 hover:border-gray-600 transition-colors cursor-pointer"
          >
            <div className="min-w-0 flex-1">
              {editingId === deck.id ? (
                <input
                  className="input text-sm font-semibold py-0.5 px-2 w-full max-w-xs"
                  value={editingName}
                  autoFocus
                  onChange={e => setEditingName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  onBlur={commitRename}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <div className="flex items-center gap-1.5 group">
                  <Link to={`/decks/${deck.id}`} className="font-semibold hover:text-mtg-accent transition-colors">
                    {deck.name}
                  </Link>
                  <button
                    onClick={e => { e.stopPropagation(); startEditing(deck) }}
                    className="text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity text-sm"
                    title="Rename deck"
                  >
                    ✎
                  </button>
                </div>
              )}
              {deck.description && (
                <div className="text-xs text-gray-400 mt-0.5">{deck.description}</div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">
                {deck.card_count} cards · updated {daysAgo(deck.updated_at)}
              </span>
              <button
                onClick={e => { e.stopPropagation(); confirm(`Delete "${deck.name}"?`) && deleteMutation.mutate(deck.id) }}
                className="text-gray-600 hover:text-red-400 text-xs transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
