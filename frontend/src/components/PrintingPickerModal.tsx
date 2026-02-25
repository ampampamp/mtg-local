import { useQuery } from '@tanstack/react-query'
import { getCardPrintings } from '../api'
import type { ScryfallCard } from '../types'
import OwnershipBadge from './OwnershipBadge'

interface Props {
  oracle_id: string
  cardName: string
  onSelect: (card: ScryfallCard) => void
  onClose: () => void
  hidePrices?: boolean
}

export default function PrintingPickerModal({ oracle_id, cardName, onSelect, onClose, hidePrices = false }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['printings', oracle_id],
    queryFn: () => getCardPrintings(oracle_id),
  })

  const printings: ScryfallCard[] = [...(data?.data ?? [])].sort(
    (a, b) => (b._printing_owned ?? 0) - (a._printing_owned ?? 0)
  )
  const ownership = printings[0]?._ownership


  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 overflow-y-auto py-8"
      onClick={onClose}
    >
      <div
        className="bg-mtg-surface rounded-xl p-5 w-full max-w-3xl shadow-2xl mx-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4 gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold">{cardName}</h2>
            {ownership && <OwnershipBadge ownership={ownership} needed={0} />}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm flex-shrink-0">✕</button>
        </div>

        {isLoading && (
          <div className="text-gray-400 text-sm text-center py-10">Loading printings...</div>
        )}
        {!isLoading && printings.length === 0 && (
          <div className="text-gray-500 text-sm text-center py-10">No printings found</div>
        )}
        {!isLoading && printings.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 max-h-[70vh] overflow-y-auto pr-1">
            {printings.map(p => (
              <button
                key={p.id}
                onClick={() => onSelect(p)}
                className="text-left rounded-lg overflow-hidden bg-mtg-card hover:ring-2 hover:ring-blue-400 transition-all"
              >
                {p.image_uri ? (
                  <img src={p.image_uri} alt={p.name} className="w-full" loading="lazy" />
                ) : (
                  <div className="aspect-[2.5/3.5] bg-mtg-surface flex items-center justify-center text-gray-600 text-xs px-2 text-center">
                    {p.name}
                  </div>
                )}
                <div className="p-1.5 space-y-0.5">
                  <div className="text-xs font-medium text-gray-200 truncate">
                    {p.set?.toUpperCase()} #{p.collector_number}
                  </div>
                  <div className="text-xs text-gray-500 truncate">{p.set_name}</div>
                  <div className="flex items-center justify-between gap-1">
                    {!hidePrices && p.prices?.usd && (
                      <span className="text-xs text-mtg-gold">${p.prices.usd}</span>
                    )}
                    {(p._printing_owned ?? 0) > 0 && (
                      <span className="text-xs text-green-400 font-medium ml-auto">×{p._printing_owned} owned</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
