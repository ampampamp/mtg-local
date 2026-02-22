import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { autocompleteCards } from '../api'
import type { ScryfallCard } from '../types'
import OwnershipBadge from './OwnershipBadge'
import AddToCollectionModal from './AddToCollectionModal'

// ─── Debounce hook ────────────────────────────────────────────────────────────
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ─── Mana pip renderer ────────────────────────────────────────────────────────
function ManaCost({ cost }: { cost?: string }) {
  if (!cost) return null
  const symbols = cost.replace(/[{}]/g, ' ').trim().split(/\s+/).filter(Boolean)
  const colorMap: Record<string, string> = {
    W: 'bg-yellow-100 text-yellow-900',
    U: 'bg-blue-500 text-white',
    B: 'bg-gray-800 text-white border border-gray-600',
    R: 'bg-red-600 text-white',
    G: 'bg-green-600 text-white',
  }
  return (
    <span className="flex gap-0.5 items-center flex-shrink-0">
      {symbols.map((s, i) => (
        <span key={i} className={clsx(
          'text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none flex-shrink-0',
          colorMap[s] ?? 'bg-gray-600 text-white'
        )}>{s}</span>
      ))}
    </span>
  )
}

type Mode = 'name' | 'scryfall'

// ─── Main component ───────────────────────────────────────────────────────────
export default function SearchBar() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('name')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ScryfallCard[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const [addTarget, setAddTarget] = useState<ScryfallCard | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debouncedQuery = useDebounce(query, 150)

  // ── Global keyboard shortcut: ⌘K / Ctrl+K to focus ──────────────────────
  useEffect(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handleGlobalKey)
    return () => window.removeEventListener('keydown', handleGlobalKey)
  }, [])

  // ── Fetch autocomplete results (name mode only) ──────────────────────────
  useEffect(() => {
    if (mode !== 'name' || debouncedQuery.trim().length === 0) {
      setResults([])
      setOpen(mode === 'name' ? false : open)
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
  }, [debouncedQuery, mode])

  // ── Close on outside click ────────────────────────────────────────────────
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ── Scroll highlighted item into view ─────────────────────────────────────
  useEffect(() => {
    const el = listRef.current?.children[highlighted] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  const selectCard = useCallback((card: ScryfallCard) => {
    setAddTarget(card)
    setQuery('')
    setResults([])
    setOpen(false)
  }, [])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (mode === 'scryfall') {
      if (e.key === 'Enter' && query.trim()) {
        navigate(`/search?q=${encodeURIComponent(query.trim())}`)
        setQuery('')
        setOpen(false)
        inputRef.current?.blur()
      }
      return
    }

    // Name mode keyboard nav
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[highlighted]) selectCard(results[highlighted])
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  function toggleMode(m: Mode) {
    setMode(m)
    setQuery('')
    setResults([])
    setOpen(false)
    // Small delay so input re-renders placeholder before focus
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const placeholder = mode === 'name'
    ? 'Card name...  (⌘K)'
    : 'Scryfall query...  e.g. t:dragon c:red  (⌘K)'

  return (
    <>
      <div ref={containerRef} className="relative flex items-center w-full">
        {/* Mode toggle */}
        <div className="flex-shrink-0 flex rounded-l-md overflow-hidden border border-r-0 border-gray-600 text-xs font-medium">
          <button
            onClick={() => toggleMode('name')}
            className={clsx(
              'px-2.5 py-2 transition-colors',
              mode === 'name'
                ? 'bg-mtg-accent text-white'
                : 'bg-mtg-card text-gray-400 hover:text-white hover:bg-gray-700'
            )}
          >
            Name
          </button>
          <button
            onClick={() => toggleMode('scryfall')}
            className={clsx(
              'px-2.5 py-2 transition-colors',
              mode === 'scryfall'
                ? 'bg-mtg-accent text-white'
                : 'bg-mtg-card text-gray-400 hover:text-white hover:bg-gray-700'
            )}
          >
            Scryfall
          </button>
        </div>

        {/* Input */}
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => mode === 'name' && results.length > 0 && setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            className={clsx(
              'w-full bg-mtg-surface border border-gray-600 rounded-r-md',
              'px-3 py-2 text-sm text-gray-100 placeholder-gray-600',
              'focus:outline-none focus:border-mtg-accent transition-colors',
              'pr-16'
            )}
          />

          {/* Right-side hints */}
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            {loading && <span className="text-gray-500 text-xs animate-spin">↻</span>}
            {!loading && query && (
              <button
                onMouseDown={e => { e.preventDefault(); setQuery(''); setResults([]); setOpen(false) }}
                className="text-gray-500 hover:text-gray-300 text-xs"
              >✕</button>
            )}
            {mode === 'scryfall' && query.trim() && (
              <kbd className="text-xs text-gray-500 hidden sm:block">↵</kbd>
            )}
          </div>
        </div>

        {/* Name mode dropdown */}
        {mode === 'name' && open && (
          <ul
            ref={listRef}
            className="absolute z-50 top-full mt-1 left-0 right-0 bg-mtg-surface border border-gray-600
                       rounded-lg shadow-2xl max-h-96 overflow-y-auto"
          >
            {results.length > 0
              ? results.map((card, i) => (
                  <li
                    key={card.oracle_id}
                    onMouseDown={() => selectCard(card)}
                    onMouseEnter={() => setHighlighted(i)}
                    className={clsx(
                      'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors',
                      i === highlighted ? 'bg-mtg-card' : 'hover:bg-mtg-card/50'
                    )}
                  >
                    {/* Mini card art */}
                    {(card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal) ? (
                      <img
                        src={card.image_uris?.normal ?? card.card_faces![0].image_uris!.normal}
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
                        <ManaCost cost={card.mana_cost} />
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
                ))
              : (
                <li className="px-4 py-3 text-sm text-gray-500">
                  No cards found for "{query}"
                </li>
              )
            }
          </ul>
        )}

        {/* Scryfall mode hint */}
        {mode === 'scryfall' && (
          <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-mtg-surface border border-gray-600
                          rounded-lg shadow-xl px-4 py-2.5 text-xs text-gray-500 flex items-center justify-between">
            <span>Press <kbd className="bg-mtg-card px-1.5 py-0.5 rounded text-gray-300">↵</kbd> to search</span>
            <a
              href="https://scryfall.com/docs/syntax"
              target="_blank"
              rel="noreferrer"
              className="text-mtg-accent hover:underline"
              onMouseDown={e => e.stopPropagation()}
            >
              Syntax guide ↗
            </a>
          </div>
        )}
      </div>

      {addTarget && (
        <AddToCollectionModal card={addTarget} onClose={() => setAddTarget(null)} />
      )}
    </>
  )
}
