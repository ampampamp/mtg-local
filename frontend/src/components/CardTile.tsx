import type { ScryfallCard } from '../types'
import OwnershipBadge from './OwnershipBadge'
import FlippableCardImage from './FlippableCardImage'

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
  const backUri = card.image_uri_back ?? card.card_faces?.[1]?.image_uris?.normal

  return (
    <div className="relative group w-[180px] flex-shrink-0">
      <div className="card-hover rounded-lg overflow-hidden bg-mtg-surface">
        <FlippableCardImage
          front={getImageUri(card) ?? undefined}
          back={backUri}
          alt={card.name}
        />
      </div>

      {/* Overlay on hover */}
      <div className="absolute inset-0 rounded-lg bg-black/70 opacity-0 group-hover:opacity-100
                      transition-opacity flex flex-col justify-between p-2">
        <div className="flex justify-end items-start">
          <span className="text-xs text-gray-400">
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
