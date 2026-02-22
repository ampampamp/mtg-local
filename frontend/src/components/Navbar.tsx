import { useState, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { getBulkStatus, triggerBulkRefresh } from '../api'
import SearchBar from './SearchBar'

const nav = [
  { to: '/collection', label: '📦 Collection' },
  { to: '/decks', label: '🃏 Decks' },
  { to: '/search', label: '⚙ Advanced' },
]

export default function Navbar() {
  const { pathname } = useLocation()
  const [syncing, setSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    getBulkStatus().then((s: any) => {
      setSyncing(s.syncing)
      setLastSynced(s.downloaded_at ?? null)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (syncing) {
      pollRef.current = setInterval(async () => {
        try {
          const s = await getBulkStatus()
          setSyncing(s.syncing)
          setLastSynced(s.downloaded_at ?? null)
          if (s.last_error) setSyncError(s.last_error)
          if (!s.syncing) clearInterval(pollRef.current!)
        } catch {}
      }, 2000)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [syncing])

  async function handleSync() {
    setSyncError(null)
    try {
      await triggerBulkRefresh()
      setSyncing(true)
    } catch (e: any) {
      setSyncError(e?.response?.data?.detail ?? 'Sync failed')
    }
  }

  const formattedDate = lastSynced
    ? new Date(lastSynced).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <nav className="bg-mtg-surface border-b border-gray-700 px-4 py-2.5 flex items-center gap-4">
      <Link to="/" className="font-bold text-mtg-gold text-lg tracking-wide flex-shrink-0">
        ⚔ MTG Local
      </Link>

      {nav.map(({ to, label }) => (
        <Link
          key={to}
          to={to}
          className={clsx(
            'text-sm font-medium transition-colors flex-shrink-0',
            pathname.startsWith(to)
              ? 'text-white border-b-2 border-mtg-accent pb-0.5'
              : 'text-gray-400 hover:text-white'
          )}
        >
          {label}
        </Link>
      ))}

      {/* Unified search bar — grows to fill available space */}
      <div className="flex-1 max-w-lg mx-2">
        <SearchBar />
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        {syncError && (
          <span className="text-xs text-red-400" title={syncError}>⚠ Sync failed</span>
        )}
        {formattedDate && !syncing && (
          <span className="text-xs text-gray-500 hidden lg:block">DB: {formattedDate}</span>
        )}
        <button
          onClick={handleSync}
          disabled={syncing}
          title={syncing ? 'Syncing card database...' : 'Download latest Scryfall card data'}
          className={clsx(
            'btn text-xs flex items-center gap-1.5',
            syncing
              ? 'bg-mtg-card text-gray-400 cursor-not-allowed'
              : 'bg-mtg-card hover:bg-blue-800 text-gray-200'
          )}
        >
          <span className={clsx('inline-block', syncing && 'animate-spin')}>↻</span>
          {syncing ? 'Syncing...' : 'Sync Cards'}
        </button>
      </div>
    </nav>
  )
}
