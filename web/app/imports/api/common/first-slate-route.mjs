// Which page /new opens (client/main.jsx CreationEntry). Pure, so the routing is tested in node.
//   'retired'  a hash naming a source that no longer exists (the old Friday sample): back to /new,
//              never "could not be found"
//   'brief'    a hash with a brief or a source that exists: NewCreativeSlate, as before
//   'first'    the first run (FirstSlate): nobody here has answered it yet, ?again=1, a ?job= deep link, or a
//              person who keeps tiles of their own there (profile.startTiles: their talks' tiles, under "Yours")
//   'blank'    a blank slate (GetStarted): they answered before, a member, ?empty=1, or an old template link
import { nativeDiagramSources } from './native-diagram-brief.mjs'
import { hasStarted } from './first-slate.mjs'

const knownSources = new Set([...nativeDiagramSources, 'pilot-budget'])

export function creationRoute({ hash = '', search = '', profileStart = null, member = false, stored = null, tiles = 0 }) {
  if (hash && hash !== '#') {
    const source = new URLSearchParams(hash.replace(/^#/, '')).get('source')
    return source !== null && !knownSources.has(source) ? 'retired' : 'brief'
  }
  const params = new URLSearchParams(search)
  if (params.has('template') || params.has('templateId') || params.get('empty') === '1') return 'blank'
  if (params.get('again') === '1' || params.has('job') || params.get('talk') === '1') return 'first'
  if (Number.isInteger(tiles) && tiles > 0) return 'first'
  return member || hasStarted(profileStart, stored) ? 'blank' : 'first'
}
