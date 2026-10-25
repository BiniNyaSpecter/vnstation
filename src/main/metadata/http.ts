/**
 * The slice of `fetch` the metadata code needs. Electron's `net.fetch` and Node's
 * global `fetch` both satisfy it, and tests pass a fake, so nothing here touches
 * the network by itself.
 */
export interface HttpResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
  arrayBuffer(): Promise<ArrayBuffer>
}

export type Fetcher = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<HttpResponse>
