import type { ArtMotif, ArtStyle } from '@shared/types'

/**
 * Procedural fallback artwork. Used for sample data and for any game that has no
 * (or unreadable) cover/background art, so every entry always looks intentional.
 * Output is deterministic: the same title/style always yields the same image.
 */
export const ART_MOTIFS: readonly ArtMotif[] = ['moon', 'skyline', 'waves', 'forest', 'aurora', 'petals']

export function hashString(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function deriveArtStyle(seed: string): ArtStyle {
  const hash = hashString(seed)
  return { motif: ART_MOTIFS[hash % ART_MOTIFS.length], hue: (hash >>> 8) % 360 }
}

const hsla = (h: number, s: number, l: number, a = 1): string =>
  `hsla(${Math.round(((h % 360) + 360) % 360)}, ${s}%, ${l}%, ${a})`
const f = (n: number): number => Math.round(n * 10) / 10

interface Palette {
  top: string
  mid: string
  glow: string
  far: string
  middle: string
  near: string
  light: string
  lightSoft: string
}

const palette = (hue: number): Palette => ({
  top: hsla(hue, 48, 11),
  mid: hsla(hue + 14, 46, 24),
  glow: hsla(hue + 38, 68, 58),
  far: hsla(hue + 8, 38, 21),
  middle: hsla(hue - 6, 38, 14),
  near: hsla(hue - 14, 36, 8),
  light: hsla(hue + 46, 90, 90),
  lightSoft: hsla(hue + 46, 90, 85, 0.35)
})

/** A soft, hill-like silhouette filling everything below a wobbly horizon. */
function ridge(W: number, H: number, base: number, amp: number, steps: number, rand: () => number, fill: string): string {
  const pts: Array<[number, number]> = Array.from({ length: steps + 1 }, (_, i) => [
    (i * W) / steps,
    base + (rand() - 0.5) * 2 * amp
  ])
  let d = `M0,${f(H)} L${f(pts[0][0])},${f(pts[0][1])}`
  for (let i = 1; i <= steps; i++) {
    const [px, py] = pts[i - 1]
    const [x, y] = pts[i]
    d += ` Q${f(px)},${f(py)} ${f((px + x) / 2)},${f((py + y) / 2)}`
  }
  return `<path d="${d} L${f(W)},${f(H)} Z" fill="${fill}"/>`
}

function scene(motif: ArtMotif, W: number, H: number, hue: number, focal: number, rand: () => number): string {
  const p = palette(hue)
  const m = Math.min(W, H)
  const cx = W * focal
  const defs =
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.top}"/>` +
    `<stop offset=".6" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.glow}"/></linearGradient>` +
    `<radialGradient id="glow"><stop offset="0" stop-color="${p.light}" stop-opacity=".55"/>` +
    `<stop offset="1" stop-color="${p.light}" stop-opacity="0"/></radialGradient>` +
    `<filter id="blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${f(m * 0.03)}"/></filter></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#sky)"/>`
  const orb = (cy: number, r: number): string =>
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 3.4)}" fill="url(#glow)"/>` +
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${p.light}"/>`

  switch (motif) {
    case 'moon':
      return (
        defs + orb(H * 0.3, m * 0.12) +
        ridge(W, H, H * 0.66, H * 0.05, 7, rand, p.far) +
        ridge(W, H, H * 0.76, H * 0.05, 6, rand, p.middle) +
        ridge(W, H, H * 0.88, H * 0.04, 5, rand, p.near)
      )

    case 'skyline': {
      let out = defs + orb(H * 0.26, m * 0.07)
      const layers = [
        { base: H * 0.8, min: 0.1, max: 0.32, fill: p.far, lit: 0.1 },
        { base: H * 0.94, min: 0.12, max: 0.4, fill: p.near, lit: 0.28 }
      ]
      for (const layer of layers) {
        let x = -W * 0.02
        while (x < W) {
          const w = W * (0.05 + rand() * 0.06)
          const h = H * (layer.min + rand() * (layer.max - layer.min))
          out += `<rect x="${f(x)}" y="${f(layer.base - h)}" width="${f(w)}" height="${f(h)}" fill="${layer.fill}"/>`
          const cols = Math.max(2, Math.floor(w / (m * 0.028)))
          const rows = Math.floor(h / (m * 0.04))
          for (let c = 0; c < cols; c++) {
            for (let r = 1; r < rows; r++) {
              if (rand() < layer.lit) {
                out += `<rect x="${f(x + ((c + 0.5) * w) / cols - m * 0.006)}" y="${f(layer.base - h + r * m * 0.04)}" width="${f(m * 0.012)}" height="${f(m * 0.016)}" fill="${p.light}" opacity=".8"/>`
              }
            }
          }
          x += w + W * 0.004
        }
      }
      return out
    }

    case 'waves': {
      let out = defs + orb(H * 0.44, m * 0.1)
      out += `<rect y="${f(H * 0.5)}" width="${W}" height="${f(H * 0.5)}" fill="${p.middle}" opacity=".85"/>`
      for (let i = 0; i < 9; i++) {
        out += `<rect x="${f(cx - m * (0.1 - i * 0.008))}" y="${f(H * 0.52 + i * m * 0.045)}" width="${f(m * (0.2 - i * 0.016))}" height="${f(m * 0.012)}" rx="${f(m * 0.006)}" fill="${p.light}" opacity="${f(0.5 - i * 0.045)}"/>`
      }
      const fills = [p.far, p.middle, p.near]
      for (let k = 0; k < 3; k++) out += ridge(W, H, H * (0.62 + k * 0.12), H * 0.018, 14, rand, fills[k])
      return out
    }

    case 'forest': {
      let out = defs + orb(H * 0.24, m * 0.06)
      const bases = [H * 0.62, H * 0.76, H * 0.9]
      const fills = [p.far, p.middle, p.near]
      const sizes = [0.07, 0.1, 0.14]
      bases.forEach((base, i) => {
        out += ridge(W, H, base, H * 0.03, 8, rand, fills[i])
        const tw = m * sizes[i]
        for (let x = 0; x < W; x += tw * (0.55 + rand() * 0.5)) {
          const th = tw * (1.6 + rand() * 1.1)
          const y = base + (rand() - 0.5) * H * 0.02
          // The base extends below the horizon so trees never float above the ridge.
          out += `<path d="M${f(x)},${f(y + H * 0.06)} L${f(x + tw / 2)},${f(y - th)} L${f(x + tw)},${f(y + H * 0.06)} Z" fill="${fills[i]}"/>`
        }
        if (i < 2) {
          out += `<rect y="${f(base - H * 0.1)}" width="${W}" height="${f(H * 0.2)}" fill="${p.lightSoft}" opacity=".18" filter="url(#blur)"/>`
        }
      })
      return out
    }

    case 'aurora': {
      let out = defs
      for (let i = 0; i < 70; i++) {
        out += `<circle cx="${f(rand() * W)}" cy="${f(rand() * H * 0.62)}" r="${f(0.6 + rand() * 1.6)}" fill="${p.light}" opacity="${f(0.3 + rand() * 0.6)}"/>`
      }
      const ribbons = [
        { y: 0.28, h: 0.18, hue: hue + 70 },
        { y: 0.36, h: 0.14, hue: hue + 130 },
        { y: 0.2, h: 0.12, hue: hue + 30 }
      ]
      for (const r of ribbons) {
        out +=
          `<path d="M0,${f(H * r.y)} C${f(W * 0.25)},${f(H * (r.y - 0.1))} ${f(W * 0.5)},${f(H * (r.y + 0.12))} ${f(W * 0.75)},${f(H * (r.y - 0.04))} ` +
          `S${f(W * 0.95)},${f(H * (r.y + 0.06))} ${W},${f(H * (r.y - 0.02))} L${W},${f(H * (r.y + r.h))} ` +
          `C${f(W * 0.7)},${f(H * (r.y + r.h + 0.1))} ${f(W * 0.4)},${f(H * (r.y + r.h - 0.08))} 0,${f(H * (r.y + r.h + 0.04))} Z" ` +
          `fill="${hsla(r.hue, 80, 62, 0.5)}" filter="url(#blur)"/>`
      }
      return out + ridge(W, H, H * 0.8, H * 0.04, 8, rand, p.middle) + ridge(W, H, H * 0.92, H * 0.03, 6, rand, p.near)
    }

    case 'petals': {
      let out = defs + `<g opacity=".09">`
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6
        const b = ((i + 0.4) * Math.PI) / 6
        out += `<path d="M${f(cx)},${f(H * 0.36)} L${f(cx + Math.cos(a) * W)},${f(H * 0.36 + Math.sin(a) * W)} L${f(cx + Math.cos(b) * W)},${f(H * 0.36 + Math.sin(b) * W)} Z" fill="${p.light}"/>`
      }
      out += `</g>` + orb(H * 0.36, m * 0.14) + ridge(W, H, H * 0.8, H * 0.04, 7, rand, p.far)
      const tx = W * 0.26
      out += `<rect x="${f(tx - m * 0.012)}" y="${f(H * 0.6)}" width="${f(m * 0.024)}" height="${f(H * 0.34)}" fill="${p.near}"/>`
      for (let i = 0; i < 6; i++) {
        out += `<circle cx="${f(tx + (rand() - 0.5) * m * 0.2)}" cy="${f(H * 0.56 + (rand() - 0.5) * m * 0.1)}" r="${f(m * (0.06 + rand() * 0.04))}" fill="${p.near}"/>`
      }
      for (let i = 0; i < 26; i++) {
        const rx = m * (0.008 + rand() * 0.01)
        out += `<ellipse cx="${f(rand() * W)}" cy="${f(rand() * H * 0.82)}" rx="${f(rx)}" ry="${f(rx * 0.55)}" transform="rotate(${Math.round(rand() * 180)} ${f(rand() * W)} ${f(rand() * H)})" fill="${hsla(hue + 20, 85, 88)}" opacity="${f(0.45 + rand() * 0.45)}"/>`
      }
      return out + ridge(W, H, H * 0.92, H * 0.03, 6, rand, p.near)
    }
  }
}

const xmlEscape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const isWide = (char: string): boolean => /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char)
const visualWidth = (text: string): number => [...text].reduce((sum, char) => sum + (isWide(char) ? 2 : 1), 0)

/** Greedy word wrap that understands wide (CJK) characters. */
export function wrapTitle(title: string, maxUnits: number, maxLines: number): string[] {
  const tokens: string[] = []
  for (const word of title.split(/\s+/).filter(Boolean)) {
    if (visualWidth(word) <= maxUnits) {
      tokens.push(word)
      continue
    }
    let chunk = ''
    for (const char of word) {
      if (visualWidth(chunk + char) > maxUnits) {
        tokens.push(chunk)
        chunk = ''
      }
      chunk += char
    }
    if (chunk) tokens.push(chunk)
  }

  const lines: string[] = []
  let line = ''
  for (const token of tokens) {
    const candidate = line ? `${line} ${token}` : token
    if (visualWidth(candidate) <= maxUnits) {
      line = candidate
    } else {
      if (line) lines.push(line)
      line = token
    }
  }
  if (line) lines.push(line)

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    kept[maxLines - 1] += '…'
    return kept
  }
  return lines
}

const toDataUri = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

const cache = new Map<string, string>()
const memo = (key: string, build: () => string): string => {
  const hit = cache.get(key)
  if (hit) return hit
  const value = build()
  cache.set(key, value)
  return value
}

/** Portrait (2:3) cover with the title set in the artwork. */
export function fallbackCoverUrl(title: string, style: ArtStyle): string {
  return memo(`cover|${title}|${style.motif}|${style.hue}`, () => {
    const W = 600
    const H = 900
    const rand = mulberry32(hashString(`${title}|${style.motif}|${style.hue}`))
    const lines = wrapTitle(title, 14, 4)
    const size = lines.length <= 2 ? 58 : lines.length === 3 ? 50 : 44
    const lineHeight = size * 1.14
    const firstY = H * 0.9 - (lines.length - 1) * lineHeight
    const text = lines
      .map(
        (line, i) =>
          `<text x="${W * 0.09}" y="${f(firstY + i * lineHeight)}" font-size="${size}" font-weight="700" fill="#f6f3ff" ` +
          `font-family="'Palatino Linotype','Book Antiqua',Georgia,'Yu Mincho','Noto Serif JP',serif">${xmlEscape(line)}</text>`
      )
      .join('')
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">` +
      scene(style.motif, W, H, style.hue, 0.55, rand) +
      `<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".5" stop-color="#05060f" stop-opacity="0"/>` +
      `<stop offset="1" stop-color="#05060f" stop-opacity=".78"/></linearGradient></defs>` +
      `<rect width="${W}" height="${H}" fill="url(#fade)"/>` +
      `<rect x="18" y="18" width="${W - 36}" height="${H - 36}" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="2"/>` +
      text +
      `</svg>`
    return toDataUri(svg)
  })
}

/** Wide (16:9) background; the focal point sits right of centre so text can sit left. */
export function fallbackBackgroundUrl(style: ArtStyle): string {
  return memo(`hero|${style.motif}|${style.hue}`, () => {
    const W = 1600
    const H = 900
    const rand = mulberry32(hashString(`hero|${style.motif}|${style.hue}`))
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">` +
      scene(style.motif, W, H, style.hue, 0.72, rand) +
      `</svg>`
    return toDataUri(svg)
  })
}
