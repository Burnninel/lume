/** Keep document metadata byte-for-byte; edit it in source mode. */
export function splitFrontMatter(markdown: string): { prefix: string; body: string } {
  const match = markdown.match(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/)
  return match ? { prefix: match[0], body: markdown.slice(match[0].length) } : { prefix: '', body: markdown }
}
