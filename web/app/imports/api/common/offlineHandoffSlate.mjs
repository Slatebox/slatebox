import { handoffSummary, normalizeOfflineHandoff, offlineHandoff } from 'slateboxjs/workshops/model'

export const offlineHandoffSlate = {
  kind: 'offline-handoff',
  title: 'Field note handoff',
  initial(query) {
    const stage = query.get('stage') || 'queued'
    const choice = stage === 'resolved' ? query.get('choice') : null
    return normalizeOfflineHandoff({...offlineHandoff, stage, choice}) ?? {...offlineHandoff}
  },
  normalize: normalizeOfflineHandoff,
  labels: [
    {field:'fieldNote', caption:'Field test'},
    {field:'deskNote', caption:'Desk note'},
    {field:'fallback', caption:'Fallback instructions'},
  ],
  describe: handoffSummary,
}
