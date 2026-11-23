import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { google } from 'googleapis'
import { createJSONEditor } from 'vanilla-jsoneditor'

const require = createRequire(import.meta.url)
const markdownEditor = require('react-markdown-editor-lite')
const { Mention, MentionsInput } = require('react-mentions')
const nanoidPackage = require(
  'react-markdown-editor-lite/node_modules/nanoid/package.json'
)
const babelRuntimePackage = require('@babel/runtime/package.json')
const underscorePackage = require('underscore/package.json')

assert.equal(typeof createJSONEditor, 'function')
assert.ok(markdownEditor.default)
assert.equal(typeof Mention, 'function')
assert.ok(MentionsInput)
assert.equal(nanoidPackage.version, '3.3.11')
assert.equal(babelRuntimePackage.version, '7.29.7')
assert.equal(underscorePackage.version, '1.13.8')

const oauth = new google.auth.OAuth2(
  'contract-client',
  'contract-secret',
  'http://localhost/callback'
)
const authUrl = new URL(
  oauth.generateAuthUrl({
    access_type: 'online',
    scope: ['https://www.googleapis.com/auth/drive.file'],
  })
)

assert.equal(authUrl.hostname, 'accounts.google.com')
assert.equal(authUrl.searchParams.get('client_id'), 'contract-client')
assert.equal(authUrl.searchParams.get('redirect_uri'), 'http://localhost/callback')

console.log('Production dependency contracts passed.')
