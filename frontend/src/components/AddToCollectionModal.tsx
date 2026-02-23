import { useState } from 'react'
import type { ScryfallCard } from '../types'
import { upsertCollectionCard, deleteCollectionCard } from '../api'
import { useQueryClient } from '@tanstack/react-query'

interface Props {
  card: ScryfallCard
  onClose: () => void
  initialQty?: number
  initialFoilQty?: number
  isExisting?: boolean
}

export default function AddToCollectionModal({ card, onClose, initialQty = 1, initialFoilQty = 0, isExisting = false }: Props) {
  const qc = useQueryClient()
  const [qty, setQty] = useState(initialQty)
  const [foilQty, setFoilQty] = useState(initialFoilQty)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await upsertCollectionCard({ scryfall_id: card.id, quantity: qty, foil_quantity: foilQty, condition: 'NM' })
      qc.invalidateQueries({ queryKey: ['collection'] })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    try {
      await deleteCollectionCard(card.id)
      qc.invalidateQueries({ queryKey: ['collection'] })
      onClose()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-mtg-surface rounded-xl p-6 w-80 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex gap-3 items-start">
          {card.image_uri && (
            <img
              src={card.image_uri}
              alt={card.name}
              className="w-16 rounded flex-shrink-0"
            />
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-tight">{card.name}</h2>
            <div className="text-sm text-gray-400 mt-0.5">{card.set_name} · #{card.collector_number}</div>
          </div>
        </div>

        {isExisting && (
          <div className="flex gap-3 text-xs">
            {card.scryfall_uri && (
              <a href={card.scryfall_uri} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 transition-colors">
                Scryfall ↗
              </a>
            )}
            {card.related_uris?.edhrec && (
              <a href={card.related_uris.edhrec} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 transition-colors">
                EDHREC ↗
              </a>
            )}
            {card.purchase_uris?.tcgplayer && (
              <a href={card.purchase_uris.tcgplayer} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 transition-colors">
                TCGPlayer ↗
              </a>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-gray-400">Regular qty</span>
            <input type="number" min={0} value={qty} onChange={e => setQty(+e.target.value)} className="input" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-400">Foil qty</span>
            <input type="number" min={0} value={foilQty} onChange={e => setFoilQty(+e.target.value)} className="input" />
          </label>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={save} disabled={saving} className="btn-primary flex-1">
            {saving ? 'Saving...' : 'Save'}
          </button>
          {isExisting && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              onBlur={() => setConfirming(false)}
              className={`btn-secondary flex-1 transition-colors ${confirming ? 'bg-red-700 border-red-600 text-white hover:bg-red-600' : 'text-red-400 hover:text-red-300'}`}
            >
              {deleting ? 'Deleting...' : confirming ? 'Confirm?' : 'Delete'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
