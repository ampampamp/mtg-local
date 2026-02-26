import { useState } from 'react'

interface Props {
  tags: string[]
  onChange: (tags: string[]) => void
  onClickTag: (tag: string) => void
  existingTags?: string[]
}

export default function TagInput({ tags, onChange, onClickTag, existingTags = [] }: Props) {
  const [input, setInput] = useState('')

  const suggestion = input.length > 0
    ? (existingTags.find(t =>
        t.toLowerCase().startsWith(input.toLowerCase()) && !tags.includes(t.toLowerCase())
      ) ?? null)
    : null
  const ghostSuffix = suggestion ? suggestion.slice(input.length) : ''

  function commit() {
    if (!input.trim()) return
    const incoming = input.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    onChange([...new Set([...tags, ...incoming])])
    setInput('')
  }

  return (
    <div className="space-y-1.5">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 bg-blue-900/50 text-blue-300 text-xs px-2 py-0.5 rounded-full"
            >
              <button
                type="button"
                onClick={() => onClickTag(tag)}
                className="hover:text-white transition-colors"
                title="Filter by this tag"
              >
                {tag}
              </button>
              <button
                type="button"
                onClick={() => onChange(tags.filter(t => t !== tag))}
                className="text-blue-500 hover:text-red-400 transition-colors leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        {ghostSuffix && (
          <div
            className="absolute inset-0 flex items-center px-3 pointer-events-none overflow-hidden whitespace-pre text-xs"
            aria-hidden
          >
            <span className="invisible">{input}</span>
            <span className="text-gray-500">{ghostSuffix}</span>
          </div>
        )}
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Tab' && suggestion) {
              e.preventDefault()
              const tag = suggestion.toLowerCase()
              if (!tags.includes(tag)) onChange([...tags, tag])
              setInput('')
              return
            }
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Backspace' && !input && tags.length) {
              onChange(tags.slice(0, -1))
            }
          }}
          onBlur={commit}
          placeholder={tags.length ? 'Add more...' : 'Add tags (Enter or , to confirm)...'}
          className="input w-full text-xs"
        />
      </div>
    </div>
  )
}
