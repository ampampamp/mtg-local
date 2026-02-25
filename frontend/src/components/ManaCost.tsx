interface Props {
  cost: string
  className?: string
}

export default function ManaCost({ cost, className = 'w-4 h-4' }: Props) {
  const symbols = cost.match(/\{[^}]+\}/g) ?? []
  if (!symbols.length) return null

  return (
    <span className="inline-flex items-center gap-0.5 flex-wrap">
      {symbols.map((sym, i) => {
        // {W/U} → WU,  {2/W} → 2W,  {W} → W
        const code = sym.slice(1, -1).replace(/\//g, '')
        return (
          <img
            key={i}
            src={`https://svgs.scryfall.io/card-symbols/${code}.svg`}
            alt={sym}
            className={className}
          />
        )
      })}
    </span>
  )
}
