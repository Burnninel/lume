import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

// CSS variables let highlighting follow light, dark and system without rebuilding the editor.
export const codeTheme = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.typeName, tags.meta], color: 'var(--syntax-keyword)' },
  { tag: [tags.string, tags.regexp, tags.attributeValue], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--syntax-number)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.className, tags.tagName], color: 'var(--syntax-title)' },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: 'var(--syntax-variable)' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--syntax-punctuation)' },
  { tag: tags.invalid, color: 'var(--danger)' },
]))
