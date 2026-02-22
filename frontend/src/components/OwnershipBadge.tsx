import { useState } from 'react'
import type { Ownership } from '../types'
import clsx from 'clsx'

interface Props {
  ownership?: Ownership
  needed?: number // quantity needed by current deck
}

export default function OwnershipBadge({ ownership, needed = 1 }: Props) {
  const [showPopover, setShowPopover] = useState(false)

  if (!ownership) return null

  const { owned, in_use, available, decks } = ownership
  if (owned === 0) return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
      not owned
    </span>
  )

  const sufficient = available >= needed
  const partial = available > 0 && available < needed

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setShowPopover(v => !v)}
        className={clsx(
          'text-xs px-2 py-0.5 rounded font-mono flex gap-1 items-center',
          sufficient ? 'bg-green-900/60 text-green-300' :
          partial    ? 'bg-yellow-900/60 text-yellow-300' :
                       'bg-red-900/60 text-red-300'
        )}
      >
        <span title="Owned">⬡ {owned}</span>
        {in_use > 0 && <span title="In use" className="text-gray-400">· {in_use} used</span>}
        <span title="Available">· {available} free</span>
      </button>

      {showPopover && decks.length > 0 && (
        <div className="absolute z-50 bottom-full mb-1 left-0 bg-mtg-surface border border-gray-600
                        rounded shadow-xl p-2 min-w-48 text-xs">
          <div className="font-semibold text-gray-300 mb-1">In decks:</div>
          {decks.map(d => (
            <div key={d.deck_id} className="flex justify-between gap-4 text-gray-400">
              <span>{d.deck_name}</span>
              <span>×{d.quantity}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
