import { useState } from 'react'
import type { ScryfallCard } from '../types'
import { upsertCollectionCard } from '../api'
import { useQueryClient } from '@tanstack/react-query'

interface Props {
  card: ScryfallCard
  onClose: () => void
  initialQty?: number
  initialFoilQty?: number
}

export default function AddToCollectionModal({ card, onClose, initialQty = 1, initialFoilQty = 0 }: Props) {
  const qc = useQueryClient()
  const [qty, setQty] = useState(initialQty)
  const [foilQty, setFoilQty] = useState(initialFoilQty)
  const [saving, setSaving] = useState(false)

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

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-mtg-surface rounded-xl p-6 w-80 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold">{card.name}</h2>
        <div className="text-sm text-gray-400">{card.set_name} · #{card.collector_number}</div>

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
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary flex-1">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
