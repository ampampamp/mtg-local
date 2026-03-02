import { useState } from 'react'

interface Props {
  front?: string
  back?: string
  alt: string
  className?: string
}

export default function FlippableCardImage({ front, back, alt, className = 'w-full rounded-lg' }: Props) {
  const [flipped, setFlipped] = useState(false)
  const src = flipped ? (back ?? front) : front

  return (
    <div className="relative">
      {src ? (
        <img src={src} alt={alt} className={className} loading="lazy" />
      ) : (
        <div className="aspect-[2.5/3.5] bg-mtg-card rounded-lg flex items-center justify-center text-xs text-gray-500 px-2 text-center">
          {alt}
        </div>
      )}
      {back && (
        <button
          onClick={e => { e.stopPropagation(); setFlipped(v => !v) }}
          className="absolute top-[25%] left-1 z-10 bg-black/60 hover:bg-black/90 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm leading-none"
          title={flipped ? 'Show front' : 'Show back'}
        >↻</button>
      )}
    </div>
  )
}
