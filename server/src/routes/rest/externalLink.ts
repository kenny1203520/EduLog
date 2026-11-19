import { z } from 'zod'

/**
 * Absolute http(s) URL for links the UI renders as anchors. Plain `z.url()`
 * accepts any scheme `new URL()` parses, including `javascript:`; the database
 * enforces the same rule with `*_external_link_http_check` constraints.
 */
export const httpUrl = z.url({ protocol: /^https?$/ }).max(2048)

/** Nullable external link where an empty string is stored as null. */
export const optionalExternalLink = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  httpUrl.nullable().optional(),
)

/** Nullable external link that keeps an empty string, for callers that already store ''. */
export const externalLinkOrEmpty = z.union([z.literal(''), httpUrl]).nullable().optional()
