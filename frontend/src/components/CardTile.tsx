import { useState } from 'react'
import type { ScryfallCard } from '../types'
import OwnershipBadge from './OwnershipBadge'

interface Props {
  card: ScryfallCard
  onAdd?: (card: ScryfallCard) => void
  actionLabel?: string
  neededQty?: number
}

function getImageUri(card: ScryfallCard): string | null {
  if (card.image_uris?.normal) return card.image_uris.normal
  if (card.card_faces?.[0]?.image_uris?.normal) return card.card_faces[0].image_uris.normal
  return null
}

export default function CardTile({ card, onAdd, actionLabel = 'Add', neededQty = 1 }: Props) {
  const [flipped, setFlipped] = useState(false)
  const isDFC = (card.card_faces?.length ?? 0) >= 2

  const imageUri = isDFC && flipped
    ? card.card_faces![1]?.image_uris?.normal
    : getImageUri(card)

  return (
    <div className="relative group w-[180px] flex-shrink-0">
      <div className="card-hover rounded-lg overflow-hidden bg-mtg-surface">
        {imageUri ? (
          <img src={imageUri} alt={card.name} className="w-full rounded-lg" loading="lazy" />
        ) : (
          <div className="w-full aspect-[5/7] bg-mtg-card flex items-center justify-center rounded-lg">
            <span className="text-sm text-gray-400 text-center px-2">{card.name}</span>
          </div>
        )}
      </div>

      {/* Overlay on hover */}
      <div className="absolute inset-0 rounded-lg bg-black/70 opacity-0 group-hover:opacity-100
                      transition-opacity flex flex-col justify-between p-2">
        <div className="flex justify-between items-start">
          {isDFC && (
            <button onClick={() => setFlipped(v => !v)}
              className="text-xs bg-gray-700 hover:bg-gray-600 rounded px-1.5 py-0.5">
              ↔ Flip
            </button>
          )}
          <span className="text-xs text-gray-400 ml-auto">
            {card.set?.toUpperCase()} #{card.collector_number}
          </span>
        </div>

        <div className="space-y-1">
          <div className="text-xs font-semibold text-white leading-tight">{card.name}</div>
          <div className="text-xs text-gray-400">{card.type_line}</div>
          {card.prices?.usd && (
            <div className="text-xs text-mtg-gold">${card.prices.usd}</div>
          )}
          <OwnershipBadge ownership={card._ownership} needed={neededQty} />
          {onAdd && (
            <button onClick={() => onAdd(card)} className="btn-primary w-full text-xs mt-1">
              {actionLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
