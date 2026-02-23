import { useState, useEffect, useRef, useCallback } from 'react'
import clsx from 'clsx'
import { autocompleteCards } from '../api'
import type { ScryfallCard } from '../types'
import OwnershipBadge from './OwnershipBadge'

interface Props {
  placeholder?: string
  onSelect: (card: ScryfallCard) => void
  autoFocus?: boolean
  clearOnSelect?: boolean
  className?: string
  inline?: boolean
  /** Assign a function to this ref to programmatically focus the input */
  focusRef?: React.MutableRefObject<(() => void) | null>
  /** Called when the input receives focus */
  onFocus?: () => void
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function ManaSymbol({ cost }: { cost?: string }) {
  if (!cost) return null
  // Render mana cost as colored text badges
  const symbols = cost.replace(/[{}]/g, ' ').trim().split(' ').filter(Boolean)
  const colorMap: Record<string, string> = {
    W: 'bg-yellow-100 text-yellow-900',
    U: 'bg-blue-500 text-white',
    B: 'bg-gray-800 text-white',
    R: 'bg-red-600 text-white',
    G: 'bg-green-600 text-white',
    C: 'bg-gray-400 text-gray-900',
  }
  return (
    <span className="flex gap-0.5 items-center">
      {symbols.map((s, i) => (
        <span key={i} className={clsx(
          'text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none',
          colorMap[s] ?? 'bg-gray-600 text-white'
        )}>
          {s}
        </span>
      ))}
    </span>
  )
}

export default function CardAutocomplete({
  placeholder = 'Search cards by name...',
  onSelect,
  autoFocus = false,
  clearOnSelect = false,
  className,
  focusRef,
  onFocus,
}: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ScryfallCard[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // Expose focus to parent via focusRef
  if (focusRef) focusRef.current = () => inputRef.current?.focus()
  const listRef = useRef<HTMLUListElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debouncedQuery = useDebounce(query, 150)

  // Fetch results when debounced query changes
  useEffect(() => {
    if (debouncedQuery.trim().length === 0) {
      setResults([])
      setOpen(false)
      return
    }
    let cancelled = false
    setLoading(true)
    autocompleteCards(debouncedQuery.trim())
      .then(res => {
        if (!cancelled) {
          setResults(res.data ?? [])
          setHighlighted(0)
          setOpen(true)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debouncedQuery])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSelect = useCallback((card: ScryfallCard) => {
    onSelect(card)
    if (clearOnSelect) {
      setQuery('')
      setResults([])
    } else {
      setQuery(card.name)
    }
    setOpen(false)
  }, [onSelect, clearOnSelect])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[highlighted]) handleSelect(results[highlighted])
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  // Scroll highlighted item into view
  useEffect(() => {
    const el = listRef.current?.children[highlighted] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  return (
    <div ref={containerRef} className={clsx('relative', className)}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); onFocus?.() }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="input pr-8"
          autoComplete="off"
          spellCheck={false}
        />
        {loading && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs animate-spin">
            ↻
          </span>
        )}
        {!loading && query && (
          <button
            onClick={() => { setQuery(''); setResults([]); setOpen(false); inputRef.current?.focus() }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-50 top-full mt-1 left-0 right-0 bg-mtg-surface border border-gray-600
                     rounded-lg shadow-2xl max-h-96 overflow-y-auto"
        >
          {results.map((card, i) => (
            <li
              key={card.oracle_id}
              onMouseDown={() => handleSelect(card)}
              onMouseEnter={() => setHighlighted(i)}
              className={clsx(
                'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors',
                i === highlighted ? 'bg-mtg-card' : 'hover:bg-mtg-card/50'
              )}
            >
              {/* Tiny card image */}
              {card.image_uri ? (
                <img
                  src={card.image_uri}
                  alt=""
                  className="w-8 h-11 rounded object-cover flex-shrink-0"
                  loading="lazy"
                />
              ) : (
                <div className="w-8 h-11 rounded bg-mtg-card flex-shrink-0" />
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{card.name}</span>
                  <ManaSymbol cost={card.mana_cost} />
                </div>
                <div className="text-xs text-gray-500 truncate">{card.type_line}</div>
              </div>

              <div className="flex-shrink-0 text-right space-y-0.5">
                {card.prices?.usd && (
                  <div className="text-xs text-mtg-gold">${card.prices.usd}</div>
                )}
                <OwnershipBadge ownership={card._ownership} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && query.length > 0 && results.length === 0 && !loading && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-mtg-surface border border-gray-600
                        rounded-lg shadow-xl px-4 py-3 text-sm text-gray-500">
          No cards found for "{query}"
        </div>
      )}
    </div>
  )
}
