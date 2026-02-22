import { useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { searchCards } from '../api'
import type { ScryfallCard } from '../types'
import CardTile from '../components/CardTile'
import AddToCollectionModal from '../components/AddToCollectionModal'

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [addTarget, setAddTarget] = useState<ScryfallCard | null>(null)
  const [page, setPage] = useState(1)

  // Read ?q= from URL — populated when navigating from the Scryfall mode in SearchBar
  const urlQuery = searchParams.get('q') ?? ''
  const [inputValue, setInputValue] = useState(urlQuery)
  const [submitted, setSubmitted] = useState(urlQuery)

  // Sync input if URL param changes (e.g. navigating from navbar)
  useEffect(() => {
    if (urlQuery && urlQuery !== submitted) {
      setInputValue(urlQuery)
      setSubmitted(urlQuery)
      setPage(1)
    }
  }, [urlQuery])

  const { data, isFetching, isError } = useQuery({
    queryKey: ['search', submitted, page],
    queryFn: () => searchCards(submitted, page),
    enabled: submitted.length > 0,
  })

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    const q = inputValue.trim()
    setPage(1)
    setSubmitted(q)
    setSearchParams(q ? { q } : {})
  }, [inputValue])

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          className="input flex-1"
          placeholder='Scryfall syntax, e.g. "c:red cmc=3" or "t:dragon f:commander"'
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
        />
        <button type="submit" className="btn-primary">Search</button>
      </form>

      <div className="text-xs text-gray-500">
        Full{' '}
        <a href="https://scryfall.com/docs/syntax" target="_blank" rel="noreferrer"
          className="text-mtg-accent hover:underline">
          Scryfall search syntax
        </a>
        {' '}supported. Use the Navbar search for quick card name lookup.
      </div>

      {isFetching && <div className="text-gray-400 text-sm">Searching...</div>}
      {isError && <div className="text-red-400 text-sm">Search failed. Check the backend is running.</div>}

      {data && (
        <>
          <div className="text-sm text-gray-400">{data.total_cards} cards found</div>
          <div className="flex flex-wrap gap-3">
            {data.data?.map((card: ScryfallCard) => (
              <CardTile
                key={card.id}
                card={card}
                onAdd={setAddTarget}
                actionLabel="+ Collection"
              />
            ))}
          </div>

          <div className="flex gap-2 items-center pt-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-secondary disabled:opacity-40"
            >← Prev</button>
            <span className="text-sm text-gray-400">Page {page}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!data.has_more}
              className="btn-secondary disabled:opacity-40"
            >Next →</button>
          </div>
        </>
      )}

      {!submitted && (
        <div className="text-center text-gray-600 mt-16">
          <div className="text-4xl mb-2">🔍</div>
          <div className="text-lg">Search with Scryfall syntax</div>
          <div className="text-sm mt-1">For card name lookup, use the search bar in the navbar</div>
        </div>
      )}

      {addTarget && (
        <AddToCollectionModal card={addTarget} onClose={() => setAddTarget(null)} />
      )}
    </div>
  )
}
