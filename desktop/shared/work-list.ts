/** Indexed works that could not be read. Never include filesystem/error details. */
export interface UnavailableWork {
  workId: string
  novelId: string
  title: string
  reason: 'stale-lease' | 'unavailable'
}
