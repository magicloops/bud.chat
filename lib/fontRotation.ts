interface HeaderFontConfig {
  fontFamily: string
  text: string
  className: string
}

const HEADER_FONTS: HeaderFontConfig[] = [
  { fontFamily: 'Pacifico', text: 'bud.chat', className: 'text-2xl ' },
  { fontFamily: 'Griffy', text: 'bud.chat', className: 'text-3xl font-semibold' },
  { fontFamily: 'Leckerli One', text: 'bud.chat', className: 'text-2xl font-semibold' },
  { fontFamily: 'Cherry Bomb One', text: 'bud.chat', className: 'text-2xl font-semibold' },
  { fontFamily: 'Chewy', text: 'bud.chat', className: 'text-2xl font-semibold' },
  { fontFamily: 'Jua', text: 'bud.chat', className: 'text-lg font-semibold' },
  { fontFamily: 'Schoolbell', text: 'bud.chat', className: 'text-lg font-semibold' },
  { fontFamily: 'Arbutus', text: 'bud.chat', className: 'text-xl font-semibold' },
  { fontFamily: 'Arbutus Slab', text: 'bud.chat', className: 'text-xl font-semibold' },
  { fontFamily: 'Fauna One', text: 'bud.chat', className: 'text-lg font-semibold' },
  { fontFamily: 'Nabla', text: 'BUD.CHAT', className: 'text-2xl font-semibold' },
  { fontFamily: 'Fleur De Leah', text: 'Bud.Chat', className: 'text-2xl font-semibold' },
  { fontFamily: 'Permanent Marker', text: 'bud.chat', className: 'text-2xl font-semibold' },
  { fontFamily: 'Seaweed Script', text: 'bud.chat', className: 'text-3xl font-semibold' }
]

export function getRandomHeaderFont(): HeaderFontConfig {
  const randomIndex = Math.floor(Math.random() * HEADER_FONTS.length)
  return HEADER_FONTS[randomIndex]
}
