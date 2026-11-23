import {encodeWorkshopFragment, validateWorkshop} from 'slateboxjs/workshops/model'

export const legacyWorkshopKeys = {
  lanes: 'slatebox.workshop.v1.', map: 'slatebox.map.v1.',
  'customer-import': 'slatebox.map.import.v1.', 'release-plan': 'slatebox.release.v1.',
}

// Local drafts use structured, validated models in DDP. The smaller URL fragment
// ceiling still applies to ordinary links pasted or shared between browsers.
export const storedWorkshopLimit = 256 * 1024
export function storedWorkshopData(value) {
  const json = JSON.stringify(validateWorkshop(value))
  if (json.length > storedWorkshopLimit) throw new Error('This workshop exceeds the local draft limit.')
  return 'draft:' + json
}

export function readStoredWorkshop(data) {
  if (typeof data !== 'string' || !data.startsWith('draft:') || data.length > storedWorkshopLimit + 6) throw new Error('Invalid workshop draft.')
  return validateWorkshop(JSON.parse(data.slice(6)))
}

export function legacyWorkshopEntry({format, sample, userId, storage, customerImport}) {
  const kind = sample === 'customer-import' ? sample : format
  const prefix = legacyWorkshopKeys[kind]
  let record, draft
  try {
    record = JSON.parse(storage.getItem(prefix + (userId || 'guest')))
    draft = validateWorkshop(record.draft)
  } catch { /* There is no valid session draft for this actor. */ }
  if (draft) {
    const data = storedWorkshopData(draft)
    if (userId && record.nativeOwner === userId && record.nativeData === data && /^[a-f0-9]{10}$/.test(record.nativeShareId)) {
      return {to:'/canvas/'+record.nativeShareId}
    }
    return {to:'/new/workshop', state:{localWorkshop:data, legacyWorkshop:{kind,userId:userId || null}}}
  }
  if (sample === 'customer-import') return {to:'/new/workshop'+encodeWorkshopFragment(customerImport)}
  return {to:format === 'lanes' ? '/new/workshop' : '/new/map'}
}

export function rememberLegacyWorkshop({source, data, shareId, owner, storage}) {
  if (!source || !Object.hasOwn(legacyWorkshopKeys,source.kind) || !owner || (source.userId && source.userId !== owner)) return
  const prefix = legacyWorkshopKeys[source.kind]
  const previous = JSON.parse(storage.getItem(prefix + (source.userId || 'guest')))
  if (!previous?.draft || storedWorkshopData(previous.draft) !== data) return
  const updated = JSON.stringify({...previous,nativeShareId:shareId,nativeOwner:owner,nativeData:data})
  storage.setItem(prefix + (source.userId || 'guest'),updated)
  if (!source.userId && !storage.getItem(prefix+owner)) storage.setItem(prefix+owner,updated)
}
