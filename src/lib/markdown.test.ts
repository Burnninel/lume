import { describe, expect, it } from 'vitest'
import { splitFrontMatter } from './markdown'

describe('metadata preservation', () => {
  it('preserves exact YAML bytes including CRLF and non-ASCII metadata', () => {
    const prefix = '---\r\ntitle: Olá\r\ntags: [projeto]\r\n---\r\n'
    expect(splitFrontMatter(prefix + '\r\n# Texto')).toEqual({ prefix, body: '\r\n# Texto' })
  })
  it('does not strip an ordinary horizontal rule without a metadata closing fence', () => {
    const body = '---\n\n# Uma pausa\n\nTexto.'
    expect(splitFrontMatter(body)).toEqual({ prefix: '', body })
  })
})
