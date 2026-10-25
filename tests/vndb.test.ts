import { describe, expect, it } from 'vitest'
import { UserFacingError } from '../src/main/errors'
import { RequestScheduler } from '../src/main/metadata/scheduler'
import {
  isImageSafe, isVndbImageUrl, normalizeDate, parseSearchResponse, parseVnDetails, pickBackground, pickTags,
  ratingFromMinAge, ratingFromSignals, stripVndbFormatting, strictest, VndbProvider, type ParsedImage
} from '../src/main/metadata/vndb'
import { detailsResponse, fakeFetcher, jsonResponse, releasesResponse, restrictedDetailsResponse, searchResponse } from './fixtures/vndb'

describe('content safety rules', () => {
  it('only allows images that are clearly safe', () => {
    expect(isImageSafe({ sexual: 0, violence: 0 })).toBe(true)
    expect(isImageSafe({ sexual: 0.49, violence: 1.4 })).toBe(true)
    expect(isImageSafe({ sexual: 0.5, violence: 0 })).toBe(false)
    expect(isImageSafe({ sexual: 0, violence: 1.5 })).toBe(false)
    expect(isImageSafe({ sexual: 2, violence: 2 })).toBe(false)
  })

  it('derives a rating from release age ratings, strictest first', () => {
    expect(ratingFromMinAge([])).toBe('unrated')
    expect(ratingFromMinAge([0])).toBe('all-ages')
    expect(ratingFromMinAge([0, 12])).toBe('teen')
    expect(ratingFromMinAge([12, 17])).toBe('mature')
    expect(ratingFromMinAge([0, 18])).toBe('restricted')
  })

  it('derives a rating from cover flags and sexual-content tags', () => {
    const ero = (rating: number, spoiler = 0) => ({ name: 'x', category: 'ero', rating, spoiler })
    expect(ratingFromSignals({ sexual: 0, violence: 0 }, [])).toBe('unrated')
    expect(ratingFromSignals({ sexual: 1.6, violence: 0 }, [])).toBe('restricted')
    expect(ratingFromSignals({ sexual: 0.6, violence: 0 }, [])).toBe('mature')
    expect(ratingFromSignals(null, [ero(2)])).toBe('restricted')
    expect(ratingFromSignals(null, [ero(1)])).toBe('mature')
    expect(ratingFromSignals(null, [ero(3, 2)])).toBe('unrated') // spoiler-level tags do not count
  })

  it('combines ratings by taking the most restrictive; unrated never wins', () => {
    expect(strictest('unrated', 'all-ages')).toBe('all-ages')
    expect(strictest('teen', 'restricted')).toBe('restricted')
    expect(strictest('mature', 'teen')).toBe('mature')
  })

  it('only trusts https images hosted by VNDB', () => {
    expect(isVndbImageUrl('https://t.vndb.org/cv/01/101.jpg')).toBe(true)
    expect(isVndbImageUrl('https://vndb.org/x.jpg')).toBe(true)
    expect(isVndbImageUrl('http://t.vndb.org/x.jpg')).toBe(false)
    expect(isVndbImageUrl('https://evil.example/x.jpg')).toBe(false)
    expect(isVndbImageUrl('https://vndb.org.evil.example/x.jpg')).toBe(false)
    expect(isVndbImageUrl('file:///etc/passwd')).toBe(false)
    expect(isVndbImageUrl('nonsense')).toBe(false)
  })
})

describe('text and data cleanup', () => {
  it('removes spoilers completely and turns formatting codes into plain text', () => {
    const text = stripVndbFormatting('Intro.\n\n[spoiler]Secret[/spoiler]\n\nSee [url=https://x.org]the site[/url]. [b]Bold[/b] [i]it[/i]\n\n\n\nEnd')
    expect(text).toBe('Intro.\n\nSee the site. Bold it\n\nEnd')
    expect(text).not.toContain('Secret')
  })

  it('drops everything after an unclosed spoiler tag', () => {
    expect(stripVndbFormatting('Safe. [spoiler]Never closed and very revealing')).toBe('Safe.')
  })

  it('normalises dates', () => {
    expect(normalizeDate('2022-10-28')).toBe('2022-10-28')
    expect(normalizeDate('2022-10')).toBe('2022-10')
    expect(normalizeDate('2022')).toBe('2022')
    for (const bad of ['TBA', 'unknown', '', null, 20220101, '28/10/2022']) expect(normalizeDate(bad)).toBeNull()
  })

  it('picks the highest-rated, non-spoiler content tags only', () => {
    const tags = [
      { name: 'B', category: 'cont', rating: 2.0, spoiler: 0 },
      { name: 'A', category: 'cont', rating: 2.9, spoiler: 0 },
      { name: 'Spoiler', category: 'cont', rating: 3, spoiler: 1 },
      { name: 'Technical', category: 'tech', rating: 3, spoiler: 0 },
      { name: 'Sexual', category: 'ero', rating: 3, spoiler: 0 },
      { name: 'Weak', category: 'cont', rating: 1.0, spoiler: 0 }
    ]
    expect(pickTags(tags)).toEqual(['A', 'B'])
  })

  it('picks the widest safe screenshot that is big enough', () => {
    const shot = (width: number, sexual = 0, violence = 0): ParsedImage => ({ url: `https://t.vndb.org/${width}.jpg`, thumbnail: null, width, height: 0, sexual, violence })
    expect(pickBackground([shot(640), shot(1280), shot(1920, 1), shot(1600)])?.width).toBe(1600)
    expect(pickBackground([shot(640), shot(1920, 2)])).toBeNull()
    expect(pickBackground([])).toBeNull()
  })
})

describe('parseSearchResponse', () => {
  const candidates = parseSearchResponse(searchResponse)

  it('keeps valid entries and silently drops malformed ones', () => {
    expect(candidates.map((c) => c.externalId)).toEqual(['v101', 'v102', 'v103', 'v104'])
  })

  it('maps fields to readable values', () => {
    expect(candidates[0]).toEqual({
      provider: 'vndb', externalId: 'v101', title: 'Lanterns of Hollowmere', originalTitle: 'ホロウメアの灯',
      releaseDate: '2022-10-28', developers: ['Paper Lantern Studio'], languages: ['Japanese', 'English'],
      thumbnailUrl: 'https://t.vndb.org/cv.t/01/101.jpg', contentRating: 'unrated'
    })
    expect(candidates[2].releaseDate).toBeNull() // "TBA"
  })

  it('never exposes thumbnails for flagged images or foreign hosts, and marks adult titles', () => {
    expect(candidates[1].thumbnailUrl).toBe('https://t.vndb.org/cv.t/02/102.jpg')
    expect(candidates[2].thumbnailUrl).toBeNull()
    expect(candidates[2].contentRating).toBe('restricted')
    expect(candidates[3].thumbnailUrl).toBeNull()
  })

  it('rejects responses that are not the documented shape', () => {
    expect(() => parseSearchResponse(null)).toThrow('could not read')
    expect(() => parseSearchResponse({ nope: [] })).toThrow(UserFacingError)
    expect(parseSearchResponse({ results: [] })).toEqual([])
  })
})

describe('parseVnDetails', () => {
  it('builds clean details with filtered artwork, tags and titles', () => {
    const d = parseVnDetails(detailsResponse, [12, 12])
    expect(d.source).toEqual({ provider: 'vndb', externalId: 'v101' })
    expect(d.title).toBe('Lanterns of Hollowmere')
    expect(d.originalTitle).toBe('ホロウメアの灯')
    expect(d.originalLanguage).toBe('Japanese')
    expect(d.languages.slice(0, 2)).toEqual(['Japanese', 'English'])
    expect(d.languages[2]).toContain('Chinese') // exact wording depends on the ICU data
    expect(d.developer).toBe('Paper Lantern Studio, Moth & Co')
    expect(d.releaseDate).toBe('2022-10-28')
    expect(d.tags).toEqual(['Atmospheric', 'Ghosts'])
    expect(d.genres).toEqual([])
    expect(d.contentRating).toBe('teen')
    expect(d.coverRemoteUrl).toBe('https://t.vndb.org/cv/01/101.jpg')
    // 1920 (sexual 1.5), 1600 (violence 1.8) and 640 (too small) are skipped; the 1920 safe one wins
    expect(d.backgroundRemoteUrl).toBe('https://t.vndb.org/sf/05/205.jpg')
  })

  it('removes spoilers and formatting from the synopsis', () => {
    const synopsis = parseVnDetails(detailsResponse, []).synopsis!
    expect(synopsis).toContain('Every autumn the lanterns are lit for the drowned.')
    expect(synopsis).toContain('Read more at the studio site. Bold and italic.')
    expect(synopsis).not.toContain('ghost')
    expect(synopsis).not.toContain('[b]')
    expect(synopsis).not.toContain('[url')
    expect(synopsis).not.toContain('[spoiler')
    expect(synopsis).toContain('[From the official website]') // plain bracketed text is kept
  })

  it('lists alternative titles once each, without the main or original title', () => {
    const d = parseVnDetails(detailsResponse, [])
    expect(d.altTitles).toEqual(['Horowumea no Akari', '호로메어의 등불', 'Hollowmere Lanterns', 'HOLLOWMERE'])
  })

  it('treats adults-only games as metadata-only: no synopsis, no artwork', () => {
    const d = parseVnDetails(restrictedDetailsResponse, [18])
    expect(d.contentRating).toBe('restricted')
    expect(d.title).toBe('Velvet Static')
    expect(d.developer).toBe('Paper Lantern Studio, Moth & Co')
    expect(d.synopsis).toBeNull()
    expect(d.coverRemoteUrl).toBeNull()
    expect(d.backgroundRemoteUrl).toBeNull()
  })

  it('also catches adult games that have no age rating, via their tags', () => {
    const d = parseVnDetails(restrictedDetailsResponse, [])
    expect(d.contentRating).toBe('restricted')
    expect(d.synopsis).toBeNull()
  })

  it('lets the strictest release age rating win', () => {
    expect(parseVnDetails(detailsResponse, [0, 12, 17]).contentRating).toBe('mature')
  })

  it('reports missing and malformed entries clearly', () => {
    expect(() => parseVnDetails({ results: [] }, [])).toThrow('no entry')
    expect(() => parseVnDetails({ results: [{ id: 'x1' }] }, [])).toThrow('could not read')
    expect(() => parseVnDetails('nope', [])).toThrow(UserFacingError)
  })

  it('treats a missing image flag as unsafe', () => {
    const response = { results: [{ id: 'v9', title: 'T', image: { url: 'https://t.vndb.org/cv/9.jpg' } }] }
    expect(parseVnDetails(response, []).coverRemoteUrl).toBeNull()
  })
})

describe('adult content policy', () => {
  it('keeps descriptions and artwork for adults-only games once the age is confirmed', () => {
    const d = parseVnDetails(restrictedDetailsResponse, [18], 'adult')
    expect(d.contentRating).toBe('restricted')
    expect(d.synopsis).toBe('An adult description that must never be shown.')
    expect(d.coverRemoteUrl).toBe('https://t.vndb.org/cv/01/101.jpg')
    expect(d.backgroundRemoteUrl).not.toBeNull()
  })

  it('allows covers whatever their flags, but backgrounds still skip explicit or brutal screenshots', () => {
    const explicitCover = { results: [{ id: 'v9', title: 'T', image: { url: 'https://t.vndb.org/cv/9.jpg', sexual: 2, violence: 0 },
      screenshots: [
        { url: 'https://t.vndb.org/sf/1.jpg', dims: [1920, 1080], sexual: 1.8, violence: 0 },
        { url: 'https://t.vndb.org/sf/2.jpg', dims: [1600, 900], sexual: 1.0, violence: 0 },
        { url: 'https://t.vndb.org/sf/3.jpg', dims: [1280, 720], sexual: 0, violence: 2 }
      ] }] }
    const adult = parseVnDetails(explicitCover, [], 'adult')
    expect(adult.coverRemoteUrl).toBe('https://t.vndb.org/cv/9.jpg')
    expect(adult.backgroundRemoteUrl).toBe('https://t.vndb.org/sf/2.jpg') // suggestive is fine, explicit and brutal are not
    expect(parseVnDetails(explicitCover, [], 'family').coverRemoteUrl).toBeNull()
  })

  it('shows thumbnails of adult search results only in adult mode', () => {
    expect(parseSearchResponse(searchResponse, 'family').find((c) => c.externalId === 'v103')?.thumbnailUrl).toBeNull()
    expect(parseSearchResponse(searchResponse, 'adult').find((c) => c.externalId === 'v103')?.thumbnailUrl).toBe('https://t.vndb.org/cv.t/03/103.jpg')
  })

  it('never accepts images from other hosts, in any mode', () => {
    expect(parseSearchResponse(searchResponse, 'adult').find((c) => c.externalId === 'v104')?.thumbnailUrl).toBeNull()
  })
})

describe('VndbProvider', () => {
  const instant = new RequestScheduler({ minIntervalMs: 0, maxPerWindow: 1000, windowMs: 1000 })

  it('sends a documented search query', async () => {
    const { fetcher, requests } = fakeFetcher(() => jsonResponse(searchResponse))
    const results = await new VndbProvider(fetcher, instant, 'VNStation/9.9').search('lanterns')
    expect(results).toHaveLength(4)
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://api.vndb.org/kana/vn')
    expect(requests[0].method).toBe('POST')
    expect(requests[0].headers?.['User-Agent']).toBe('VNStation/9.9')
    expect(requests[0].body).toMatchObject({ filters: ['search', '=', 'lanterns'], sort: 'searchrank', results: 10 })
  })

  it('fetches details and release age ratings in two requests', async () => {
    const { fetcher, requests } = fakeFetcher((r) => jsonResponse(r.url.endsWith('/release') ? releasesResponse(0, 18) : detailsResponse))
    const details = await new VndbProvider(fetcher, instant).getDetails('v101')
    expect(requests.map((r) => r.url)).toEqual(['https://api.vndb.org/kana/vn', 'https://api.vndb.org/kana/release'])
    expect(requests[1].body).toMatchObject({ filters: ['vn', '=', ['id', '=', 'v101']], fields: 'minage' })
    expect(details.contentRating).toBe('restricted')
  })

  it('refuses malformed ids without sending anything', async () => {
    const { fetcher, requests } = fakeFetcher(() => jsonResponse({}))
    await expect(new VndbProvider(fetcher, instant).getDetails('v1; DROP')).rejects.toThrow('not valid')
    expect(requests).toHaveLength(0)
  })

  it('fails the whole lookup if age ratings cannot be fetched', async () => {
    const { fetcher } = fakeFetcher((r) => (r.url.endsWith('/release') ? jsonResponse('busy', 500) : jsonResponse(detailsResponse)))
    await expect(new VndbProvider(fetcher, instant).getDetails('v101')).rejects.toThrow('having trouble')
  })

  it('explains every failure in plain language', async () => {
    const run = (response: () => Promise<never> | ReturnType<typeof jsonResponse>) =>
      new VndbProvider(fakeFetcher(response as never).fetcher, instant).search('x')
    await expect(run(() => jsonResponse('', 429))).rejects.toThrow('slow down')
    await expect(run(() => jsonResponse('', 502))).rejects.toThrow('having trouble')
    await expect(run(() => jsonResponse('', 400))).rejects.toThrow('error 400')
    await expect(run(() => Promise.reject(new TypeError('fetch failed')))).rejects.toThrow('Could not reach VNDB')
    await expect(run(() => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' })))).rejects.toThrow('took too long')
    const badJson = { ...jsonResponse({}), json: async () => { throw new SyntaxError('x') } }
    await expect(run(() => badJson)).rejects.toThrow('could not read')
  })
})
