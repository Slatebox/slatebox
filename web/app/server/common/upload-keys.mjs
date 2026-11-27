// The names a person's uploads are stored under, for every upload path (the editor's /sbupload/image
// and slates.addPhoto from the phone app): <YYYY>/<MM>/<DD>/u_<userId>_<id>.<ext>. One name for both,
// so images.removeImage and the slate's own clean-up know either kind as that person's file.
// MIT, runs without Meteor (scripts/photo-notes.test.mjs).

/** Today's folder, 2026/11/27. */
export function dateFolder(at = new Date()) {
  return `${at.getFullYear()}/${String(at.getMonth() + 1).padStart(2, '0')}/${String(at.getDate()).padStart(2, '0')}`
}

/** The key a person's upload is stored under. id is a Random.id() (17 letters and digits). */
export const uploadKey = (userId, id, ext, at = new Date()) => `${dateFolder(at)}/u_${userId}_${id}.${ext}`

const UPLOAD_NAME = /^u_([A-Za-z0-9]{17})_[A-Za-z0-9]{17}\.(png|jpg|gif|webp|pdf|txt)$/

/** The key when it names an upload of that person's (a dated folder, their id in the name), else null. */
export function uploadKeyFor(key, userId) {
  if (typeof key !== 'string' || !userId) return null
  const m = /^\d{4}\/\d{2}\/\d{2}\/([^/]+)$/.exec(key)
  const name = m && UPLOAD_NAME.exec(m[1])
  return name && name[1] === userId ? key : null
}
