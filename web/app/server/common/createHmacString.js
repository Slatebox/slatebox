import CryptoJS from 'crypto-js'

export default function createHmacString(publicKey, secretKey, ts) {
  const timestamp = ts || new Date().toISOString()
  const hashVal = `${publicKey}:${timestamp}`
  const hash = CryptoJS.HmacSHA256(hashVal, secretKey).toString(
    CryptoJS.enc.Base64
  )

  const authToken = ts
    ? hash
    : CryptoJS.enc.Base64.stringify(
        CryptoJS.enc.Utf8.parse(`${publicKey}:${hash}`)
      )
  return { authToken, timestamp }
}
