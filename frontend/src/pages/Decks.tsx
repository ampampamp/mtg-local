import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, Link } from 'react-router-dom'
import { getDecks, createDeck, deleteDeck } from '../api'
import type { Deck } from '../types'

export default function DecksPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [importText, setImportText] = useState('')
  const [importFileName, setImportFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data } = useQuery({ queryKey: ['decks'], queryFn: getDecks })

  const createMutation = useMutation({
    mutationFn: () => createDeck({
      name: newName.trim(),
      format: 'commander',
      description: '',
      decklist: importText.trim(),
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
    clearImport()
    createMutation.reset()
  }

  return (
    <div className="p-6 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Decks</h1>
        <button onClick={() => setCreating(true)} className="btn-primary">+ New Deck</button>
      </div>

      {creating && (
        <div className="bg-mtg-surface rounded-xl p-4 space-y-3 border border-gray-700">
          <h2 className="font-semibold">New Deck</h2>
          <input
            className="input"
            placeholder="Deck name"
            value={newName}
            autoFocus
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && newName.trim() && createMutation.mutate()}
          />

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

          {createMutation.isError && (
            <div className="text-red-400 text-xs">Failed to create deck. Check the decklist format.</div>
          )}

          <div className="flex gap-2">
            <button onClick={handleCancel} className="btn-secondary flex-1">Cancel</button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim() || createMutation.isPending}
              className="btn-primary flex-1 disabled:opacity-40"
            >
              {createMutation.isPending
                ? 'Creating...'
                : importText.trim() || importFileName
                  ? 'Create & Import'
                  : 'Create'}
            </button>
          </div>
        </div>
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
            className="bg-mtg-surface rounded-xl p-4 flex items-center justify-between border border-gray-700/50 hover:border-gray-600 transition-colors"
          >
            <div>
              <Link to={`/decks/${deck.id}`} className="font-semibold hover:text-mtg-accent transition-colors">
                {deck.name}
              </Link>
              <div className="text-xs text-gray-400 mt-0.5">
                <span className="capitalize">{deck.format}</span>
                {deck.description && ` · ${deck.description}`}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">
                {new Date(deck.updated_at).toLocaleDateString()}
              </span>
              <Link to={`/decks/${deck.id}`} className="btn-secondary text-xs">Open</Link>
              <button
                onClick={() => confirm(`Delete "${deck.name}"?`) && deleteMutation.mutate(deck.id)}
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
