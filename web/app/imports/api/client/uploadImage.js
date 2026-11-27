import uploadHeaders from './uploadHeaders'

/**
 * A picture sent to the app's one upload route (/sbupload/image, signed in with the login token):
 * → the stored file's address (the bucket's, or /files/... on a server that keeps files itself).
 * `onProgress` hears 0 to 100.
 */
export default function uploadImage(file, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/sbupload/image')
    Object.entries(uploadHeaders()).forEach(([k, v]) => xhr.setRequestHeader(k, v))
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => (xhr.status === 200 ? resolve(xhr.responseText) : reject(new Error(xhr.responseText || 'The upload failed.')))
    xhr.onerror = () => reject(new Error('The upload failed. Check your connection and try again.'))
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}
