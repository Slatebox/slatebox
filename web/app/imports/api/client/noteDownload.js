import { Meteor } from 'meteor/meteor'

// A download the browser makes itself (a PNG, an SVG, a PDF of a grid page) goes into the team's
// activity log (server/actions/audit.mjs audit.recordDownload). Never in the way of the download.
export default function noteDownload(shareId, format) {
  if (!Meteor.userId() || typeof shareId !== 'string' || !shareId) return
  Meteor.callAsync('audit.recordDownload', { shareId, format }).catch(() => {})
}
