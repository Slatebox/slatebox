// The token record as every surface shows it: never the hash, and the secret only once,
// in the answer to the create that made it.
export const tokenRecord = {
  type: 'object',
  properties: {
    _id: { type: 'string' },
    name: { type: 'string' },
    prefix: { type: 'string' },
    scopes: { type: 'array', items: { type: 'string' } },
    createdAt: { type: 'number' },
    lastUsedAt: { type: ['number', 'null'] },
    revokedAt: { type: ['number', 'null'] },
    // A connected app (OAuth, from the MCP sign-in) rather than a personal token, and when its
    // connection lapses unless the app uses it again.
    kind: { const: 'oauth' },
    refreshExpiresAt: { type: 'number' },
  },
  required: ['_id', 'name', 'prefix', 'scopes', 'createdAt'],
}

export const tokenIdInput = {
  type: 'string',
  minLength: 1,
  maxLength: 40,
  pattern: '^[A-Za-z0-9_-]+$',
  description: 'A token ID, or current for the token making the call.',
}
