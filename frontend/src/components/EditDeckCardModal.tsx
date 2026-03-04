import { useState } from 'react'
import { upsertDeckCard, removeDeckCard } from '../api'
import { useQueryClient } from '@tanstack/react-query'
import type { DeckCard } from '../types'
import TagInput from './TagInput'

interface Props {
  card: DeckCard
  deckId: number
  onClose: () => void
  onFilterByTag: (tag: string) => void
  existingTags?: string[]
  recentTags?: string[]
  onSaved?: (tags: string[]) => void
}

export default function EditDeckCardModal({
  card, deckId, onClose, onFilterByTag,
  existingTags = [], recentTags = [], onSaved,
}: Props) {
  const qc = useQueryClient()
  const [qty, setQty] = useState(card.quantity)
  const [tags, setTags] = useState<string[]>(card.tags ?? [])
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['deck', deckId] })

  async function save() {
    setSaving(true)
    try {
      await upsertDeckCard(deckId, {
        name: card.name,
        oracle_id: card.oracle_id,
        scryfall_id: card.scryfall_id,
        quantity: Math.max(1, qty),
        board: card.board,
        tags,
      })
      invalidate()
      onSaved?.(tags)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    try {
      await removeDeckCard(deckId, card.oracle_id, card.board)
      invalidate()
      onClose()
    } finally {
      setDeleting(false)
    }
  }

  const suggestible = recentTags.filter(t => !tags.includes(t))

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-mtg-surface rounded-xl p-6 w-[420px] space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex flex-col items-center gap-2">
          {card.image_uri && (
            <img src={card.image_uri} alt={card.name} className="w-full rounded-lg" />
          )}
          <div className="text-center">
            <h2 className="text-base font-bold leading-tight">{card.name}</h2>
            <div className="text-xs text-gray-400 mt-0.5 capitalize">{card.board}</div>
          </div>
        </div>

        <label className="block space-y-1">
          <span className="text-xs text-gray-400">Quantity</span>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={e => setQty(+e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save() }}
            className="input w-full"
          />
        </label>

        <div className="space-y-1">
          <span className="text-xs text-gray-400">Tags <span className="text-gray-600">(click a tag to filter deck)</span></span>
          {suggestible.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {suggestible.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTags(prev => [...prev, t])}
                  className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-400 hover:bg-blue-900/50 hover:text-blue-300 transition-colors border border-dashed border-gray-600"
                >
                  + {t}
                </button>
              ))}
            </div>
          )}
          <TagInput
            tags={tags}
            onChange={setTags}
            onClickTag={tag => { onFilterByTag(tag); onClose() }}
            existingTags={existingTags}
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={save} disabled={saving} className="btn-primary flex-1">
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            onClick={handleRemove}
            disabled={deleting}
            onBlur={() => setConfirming(false)}
            className={`btn-secondary transition-colors ${confirming ? 'bg-red-700 border-red-600 text-white hover:bg-red-600' : 'text-red-400 hover:text-red-300'}`}
          >
            {deleting ? '…' : confirming ? 'Sure?' : 'Remove'}
          </button>
        </div>
      </div>
    </div>
  )
}
