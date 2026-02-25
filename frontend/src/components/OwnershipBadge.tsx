import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Ownership } from '../types'
import clsx from 'clsx'

interface Props {
  ownership?: Ownership
  needed?: number
}

// Module-level tracker so only one popover is open at a time
let closeActive: (() => void) | null = null

export default function OwnershipBadge({ ownership, needed = 1 }: Props) {
  const [showPopover, setShowPopover] = useState(false)

  if (!ownership) return null

  const { owned, in_use, available, decks } = ownership

  const sufficient = available >= needed
  const partial = available > 0 && available < needed
  const availColor = needed === 0
    ? 'text-gray-300'
    : sufficient ? 'text-green-400' : partial ? 'text-yellow-400' : 'text-red-400'

  const stats: { value: number; label: string; color: string }[] = [
    { value: owned, label: 'owned', color: owned > 0 ? 'text-gray-200' : 'text-gray-500' },
    { value: in_use, label: 'used', color: 'text-gray-400' },
    { value: available, label: 'free', color: availColor },
  ]

  function handleClick() {
    if (!showPopover) {
      // Close whichever badge is currently open
      if (closeActive) closeActive()
      closeActive = () => setShowPopover(false)
    } else {
      closeActive = null
    }
    setShowPopover(v => !v)
  }

  return (
    <div className="relative inline-block">
      <button onClick={handleClick} className="text-left">
        <div className="flex gap-2">
          {stats.map(s => (
            <div key={s.label} className="text-center">
              <div className={clsx('text-xs font-bold leading-none', s.color)}>{s.value}</div>
              <div className="text-[10px] text-gray-600 leading-none mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </button>

      {showPopover && decks.length > 0 && (
        <div className="absolute z-50 bottom-full mb-1 left-0 bg-mtg-surface border border-gray-600
                        rounded shadow-xl p-2 min-w-48 text-xs">
          <div className="font-semibold text-gray-300 mb-1">In decks:</div>
          {decks.map(d => (
            <div key={d.deck_id} className="flex justify-between gap-4">
              <Link
                to={`/decks/${d.deck_id}`}
                className="text-blue-400 hover:text-blue-300 hover:underline truncate"
                onClick={() => { setShowPopover(false); closeActive = null }}
              >
                {d.deck_name}
              </Link>
              <span className="text-gray-400 shrink-0">×{d.quantity}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
