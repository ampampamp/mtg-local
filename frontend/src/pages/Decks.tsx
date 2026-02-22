import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDecks, createDeck, deleteDeck } from '../api'
import { Link } from 'react-router-dom'
import type { Deck } from '../types'

const FORMATS = ['commander', 'modern', 'standard', 'legacy', 'vintage', 'pioneer', 'pauper', 'custom']

export default function DecksPage() {
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newFormat, setNewFormat] = useState('commander')

  const { data } = useQuery({ queryKey: ['decks'], queryFn: getDecks })

  const createMutation = useMutation({
    mutationFn: () => createDeck({ name: newName, format: newFormat, description: '' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['decks'] })
      setCreating(false)
      setNewName('')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteDeck(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['decks'] }),
  })

  const decks: Deck[] = data?.data ?? []

  return (
    <div className="p-6 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Decks</h1>
        <button onClick={() => setCreating(true)} className="btn-primary">+ New Deck</button>
      </div>

      {creating && (
        <div className="bg-mtg-surface rounded-xl p-4 space-y-3 border border-gray-700">
          <h2 className="font-semibold">New Deck</h2>
          <input className="input" placeholder="Deck name" value={newName} onChange={e => setNewName(e.target.value)} />
          <select className="input" value={newFormat} onChange={e => setNewFormat(e.target.value)}>
            {FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={() => setCreating(false)} className="btn-secondary flex-1">Cancel</button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim()}
              className="btn-primary flex-1 disabled:opacity-40"
            >
              Create
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
          <div key={deck.id}
            className="bg-mtg-surface rounded-xl p-4 flex items-center justify-between border border-gray-700/50 hover:border-gray-600 transition-colors">
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
