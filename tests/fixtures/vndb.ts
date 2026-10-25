import type { Fetcher, HttpResponse } from '../../src/main/metadata/http'

/**
 * Hand-written fixtures in the shape documented at https://api.vndb.org/kana.
 * All titles and people are invented; nothing here was fetched from VNDB.
 */
export const searchResponse = {
  results: [
    {
      id: 'v101', title: 'Lanterns of Hollowmere', alttitle: 'ホロウメアの灯', olang: 'ja', released: '2022-10-28',
      languages: ['ja', 'en'], developers: [{ name: 'Paper Lantern Studio' }],
      image: { url: 'https://t.vndb.org/cv/01/101.jpg', thumbnail: 'https://t.vndb.org/cv.t/01/101.jpg', sexual: 0, violence: 0, dims: [600, 900] }
    },
    {
      id: 'v102', title: 'Lanterns of Hollowmere: After Story', alttitle: null, olang: 'en', released: '2023',
      languages: ['en'], developers: [{ name: 'Paper Lantern Studio' }],
      image: { url: 'https://t.vndb.org/cv/02/102.jpg', thumbnail: 'https://t.vndb.org/cv.t/02/102.jpg', sexual: 0.2, violence: 0.1, dims: [600, 900] }
    },
    {
      id: 'v103', title: 'Velvet Static', alttitle: null, olang: 'en', released: 'TBA', languages: ['en'], developers: [],
      image: { url: 'https://t.vndb.org/cv/03/103.jpg', thumbnail: 'https://t.vndb.org/cv.t/03/103.jpg', sexual: 1.9, violence: 0, dims: [600, 900] }
    },
    {
      id: 'v104', title: 'Foreign Host Cover', olang: 'en', released: '2020-01', languages: [], developers: [],
      image: { url: 'https://evil.example/x.jpg', thumbnail: 'https://evil.example/x.t.jpg', sexual: 0, violence: 0, dims: [100, 100] }
    },
    { id: 'not-an-id', title: 'Dropped: bad id' },
    { id: 'v105' },
    'garbage'
  ],
  more: false
}

const shot = (n: number, width: number, sexual = 0, violence = 0): object => ({
  url: `https://t.vndb.org/sf/0${n}/20${n}.jpg`, dims: [width, Math.round((width * 9) / 16)], sexual, violence
})

export const detailsResponse = {
  results: [
    {
      id: 'v101', title: 'Lanterns of Hollowmere', alttitle: 'ホロウメアの灯', olang: 'ja', released: '2022-10-28',
      titles: [
        { title: 'ホロウメアの灯', latin: 'Horowumea no Akari' },
        { title: 'Lanterns of Hollowmere', latin: null },
        { title: '호로메어의 등불', latin: null }
      ],
      aliases: ['Hollowmere Lanterns', 'lanterns of hollowmere', 'HOLLOWMERE'],
      languages: ['ja', 'en', 'zh-Hans'],
      description:
        'Every autumn the lanterns are lit for the drowned.\n\n[spoiler]The lantern keeper is the ghost.[/spoiler]\n\n' +
        'Read more at [url=https://example.org/page]the studio site[/url]. [b]Bold[/b] and [i]italic[/i].\n\n\n\n[From the official website]',
      image: { url: 'https://t.vndb.org/cv/01/101.jpg', sexual: 0, violence: 0, dims: [600, 900] },
      screenshots: [shot(1, 1920, 1.5), shot(2, 640), shot(3, 1280), shot(4, 1600, 0, 1.8), shot(5, 1920)],
      developers: [{ name: 'Paper Lantern Studio' }, { name: 'Moth & Co' }],
      tags: [
        { name: 'Atmospheric', category: 'cont', rating: 2.8, spoiler: 0 },
        { name: 'Ghosts', category: 'cont', rating: 2.1, spoiler: 0 },
        { name: 'Twist Ending', category: 'cont', rating: 2.9, spoiler: 2 },
        { name: 'Weak Tag', category: 'cont', rating: 0.4, spoiler: 0 },
        { name: 'Unity', category: 'tech', rating: 3, spoiler: 0 },
        { name: 'Explicit Thing', category: 'ero', rating: 0.5, spoiler: 0 }
      ]
    }
  ],
  more: false
}

/** Same game, but with the signals VNDB uses for adult titles. */
export const restrictedDetailsResponse = {
  results: [
    {
      ...detailsResponse.results[0], id: 'v103', title: 'Velvet Static', alttitle: null, description: 'An adult description that must never be shown.',
      tags: [...detailsResponse.results[0].tags, { name: 'Adult Tag', category: 'ero', rating: 2.5, spoiler: 0 }]
    }
  ]
}

export const releasesResponse = (...minages: Array<number | null>): object => ({ results: minages.map((minage, i) => ({ id: `r${i}`, minage })) })

export const jsonResponse = (body: unknown, status = 200): HttpResponse => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => body,
  arrayBuffer: async () => new ArrayBuffer(0)
})

export const bytesResponse = (bytes: Uint8Array, status = 200, headers: Record<string, string> = {}): HttpResponse => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => { throw new Error('not json') },
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
})

export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9])

export interface RecordedRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
}

/** A fetcher that records requests and answers from a routing function. */
export function fakeFetcher(route: (request: RecordedRequest) => HttpResponse | Promise<HttpResponse>): { fetcher: Fetcher; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = []
  const fetcher: Fetcher = async (url, init) => {
    const request: RecordedRequest = { url, method: init?.method, headers: init?.headers, body: init?.body ? JSON.parse(init.body) : undefined }
    requests.push(request)
    return route(request)
  }
  return { fetcher, requests }
}
