// The archive around a team export's lines (format.mjs): written and read as streams, so neither
// side holds the whole team in memory.
//
//   lines      NDJSON. Every line but the last feeds a SHA-256 digest; the last line ({"t":"end"})
//              carries that digest, the line count and an Ed25519 signature of the digest by the
//              exporting server's key, with the public key. A changed, dropped, reordered or added
//              line fails the digest; a file whose chunks don't add up fails its own hash.
//   gzip       always.
//   encrypted  when a passphrase is given: "SBXTEAM\x02", the key-derivation settings (scrypt,
//              a random salt), a random nonce prefix and a key check (so a wrong passphrase is
//              told apart from a damaged file), then frames of up to 64 KiB, each sealed
//              with AES-256-GCM. A frame's nonce holds its number and whether it is the last, and
//              every frame authenticates the header: frames can't be dropped, reordered, cut off
//              or moved between files without failing.
//
// The reader stops at the first problem with an ArchiveError, and limits what it will take:
// the uncompressed size (a small gzip can't expand without bound) and the length of one line.
import { Buffer } from 'node:buffer'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  timingSafeEqual,
  randomBytes,
  scrypt as scryptCallback,
  sign,
  verify,
} from 'node:crypto'
import { PassThrough, Readable, Transform, pipeline } from 'node:stream'
import { createGunzip, createGzip } from 'node:zlib'
import { FORMAT, LIMITS, VERSION } from './format.mjs'

export class ArchiveError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
    this.status = 422
  }
}

const MAGIC = Buffer.from('SBXTEAM\x02', 'latin1')
const GZIP = Buffer.from([0x1f, 0x8b])
const FRAME = 64 * 1024
const KDF_SCRYPT = 1
const PREAMBLE_BYTES = MAGIC.length + 2 + 16 + 7
const HEADER_BYTES = PREAMBLE_BYTES + 16
const keyCheck = (key, preamble) => createHmac('sha256', key).update('slatebox team export key check').update(preamble).digest().subarray(0, 16)
export const MIN_PASSPHRASE = 12
export const MAX_PASSPHRASE = 1024

const scrypt = (passphrase, salt, logN) =>
  new Promise((resolve, reject) =>
    scryptCallback(String(passphrase).normalize('NFKC'), salt, 32, { N: 2 ** logN, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key)
    )
  )

const nonceOf = (prefix, counter, last) => {
  const nonce = Buffer.alloc(12)
  prefix.copy(nonce, 0)
  nonce.writeUInt32BE(counter, 7)
  nonce[11] = last ? 1 : 0
  return nonce
}

// A passphrase is compared after NFKC normalization. One that encrypts an archive (writing) may
// not start or end with white space or hold control characters: those are lost or refused where a
// passphrase is typed again or sent in a header, and the archive could never be opened.
export function checkPassphrase(passphrase, { writing = false } = {}) {
  if (passphrase === undefined || passphrase === null || passphrase === '') return null
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE || passphrase.length > MAX_PASSPHRASE)
    throw new ArchiveError('passphrase_invalid', `A passphrase is ${MIN_PASSPHRASE} to ${MAX_PASSPHRASE} characters.`)
  if (writing && passphraseProblem(passphrase)) throw new ArchiveError('passphrase_invalid', passphraseProblem(passphrase))
  return passphrase
}

/** Why a passphrase may not encrypt an archive, or null. The export page asks the same. */
export function passphraseProblem(passphrase) {
  if (/^\s|\s$/u.test(passphrase)) return 'A passphrase cannot start or end with a space.'
  if (/[\p{Cc}\p{Cs}]/u.test(passphrase)) return 'A passphrase cannot hold control characters.'
  return null
}

// Seals the gzip stream in frames. The last frame is sealed when the input ends, so even an empty
// input ends with one (empty) last frame.
function encryptor(passphrase, { logN = 15 } = {}) {
  const salt = randomBytes(16)
  const prefix = randomBytes(7)
  const preamble = Buffer.concat([MAGIC, Buffer.from([KDF_SCRYPT, logN]), salt, prefix])
  let header = null
  let key = null
  let counter = 0
  let pending = Buffer.alloc(0)
  const seal = (plain, last) => {
    const cipher = createCipheriv('aes-256-gcm', key, nonceOf(prefix, counter, last))
    cipher.setAAD(header)
    const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()])
    const frameHeader = Buffer.alloc(5)
    frameHeader[0] = last ? 1 : 0
    frameHeader.writeUInt32BE(body.length, 1)
    counter += 1
    if (counter >= 0xffffffff) throw new ArchiveError('too_large', 'The archive is too large.')
    return Buffer.concat([frameHeader, body])
  }
  return new Transform({
    async transform(chunk, _encoding, done) {
      try {
        if (!key) {
          key = await scrypt(passphrase, salt, logN)
          header = Buffer.concat([preamble, keyCheck(key, preamble)])
          this.push(header)
        }
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
        while (pending.length > FRAME) {
          this.push(seal(pending.subarray(0, FRAME), false))
          pending = pending.subarray(FRAME)
        }
        done()
      } catch (error) {
        done(error)
      }
    },
    async flush(done) {
      try {
        if (!key) {
          key = await scrypt(passphrase, salt, logN)
          header = Buffer.concat([preamble, keyCheck(key, preamble)])
          this.push(header)
        }
        this.push(seal(pending, true))
        done()
      } catch (error) {
        done(error)
      }
    },
  })
}

// Reads exactly n bytes from an async byte source, or fewer at its end.
function byteReader(source) {
  const iterator = source[Symbol.asyncIterator]()
  let buffered = Buffer.alloc(0)
  let ended = false
  return {
    async read(n) {
      while (buffered.length < n && !ended) {
        const next = await iterator.next()
        if (next.done) ended = true
        else buffered = buffered.length ? Buffer.concat([buffered, Buffer.from(next.value)]) : Buffer.from(next.value)
      }
      const out = buffered.subarray(0, n)
      buffered = buffered.subarray(n)
      return out
    },
    async atEnd() {
      if (buffered.length) return false
      while (!ended) {
        const next = await iterator.next()
        if (next.done) ended = true
        else if (next.value.length) {
          buffered = Buffer.from(next.value)
          return false
        }
      }
      return true
    },
  }
}

async function* decryptFrames(reader, header, passphrase) {
  const kdf = header[MAGIC.length]
  const logN = header[MAGIC.length + 1]
  if (kdf !== KDF_SCRYPT || logN < 14 || logN > 20)
    throw new ArchiveError('format_unknown', 'This archive was sealed in a way this server does not read.')
  const salt = header.subarray(MAGIC.length + 2, MAGIC.length + 18)
  const prefix = header.subarray(MAGIC.length + 18, PREAMBLE_BYTES)
  const key = await scrypt(passphrase, salt, logN)
  if (!timingSafeEqual(keyCheck(key, header.subarray(0, PREAMBLE_BYTES)), header.subarray(PREAMBLE_BYTES, HEADER_BYTES)))
    throw new ArchiveError('passphrase_wrong', 'The passphrase does not open this archive.')
  for (let counter = 0; ; counter += 1) {
    const frameHeader = await reader.read(5)
    if (frameHeader.length < 5) throw new ArchiveError('truncated', 'The archive ends early.')
    const last = frameHeader[0] === 1
    const length = frameHeader.readUInt32BE(1)
    if (frameHeader[0] > 1 || length < 16 || length > FRAME + 16) throw new ArchiveError('corrupt', 'The archive is damaged.')
    const body = await reader.read(length)
    if (body.length < length) throw new ArchiveError('truncated', 'The archive ends early.')
    const decipher = createDecipheriv('aes-256-gcm', key, nonceOf(prefix, counter, last))
    decipher.setAAD(header)
    decipher.setAuthTag(body.subarray(length - 16))
    let plain
    try {
      plain = Buffer.concat([decipher.update(body.subarray(0, length - 16)), decipher.final()])
    } catch {
      throw new ArchiveError('corrupt', 'The archive is damaged.')
    }
    if (plain.length) yield plain
    if (last) {
      if (!(await reader.atEnd())) throw new ArchiveError('corrupt', 'The archive has data after its end.')
      return
    }
  }
}

export function publicKeyFingerprint(publicKeyDer) {
  return createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 32)
}

/**
 * The archive as a readable byte stream. records: an async iterable of line objects (no head and
 * no end: this adds both). signer: { privateKey, publicKey } KeyObjects (Ed25519), or null.
 * onEnd(summary) is called with the end line once it is written.
 */
export function writeArchive(records, { head, passphrase = null, signer = null, limits = LIMITS, onEnd, logN } = {}) {
  checkPassphrase(passphrase, { writing: true })
  const digest = createHash('sha256')
  async function* lines() {
    let count = 0
    let bytes = 0
    const counts = {}
    const emit = (record) => {
      const line = Buffer.from(JSON.stringify(record) + '\n', 'utf8')
      if (line.length > limits.lineBytes) throw new ArchiveError('too_large', 'One record is larger than an archive line may be.')
      bytes += line.length
      if (bytes > limits.totalBytes) throw new ArchiveError('too_large', 'The team is larger than an export may be.')
      digest.update(line)
      count += 1
      return line
    }
    yield emit({ t: 'head', format: FORMAT, version: VERSION, ...head })
    for await (const record of records) {
      const key = record.t === 'doc' ? record.s : record.t === 'file' ? 'files' : null
      if (key) counts[key] = (counts[key] || 0) + 1
      yield emit(record)
    }
    const hex = digest.digest('hex')
    const end = { t: 'end', lines: count, bytes, counts, digest: hex }
    if (signer) {
      const der = signer.publicKey.export({ type: 'spki', format: 'der' })
      end.signer = {
        alg: 'ed25519',
        publicKey: der.toString('base64'),
        fingerprint: publicKeyFingerprint(der),
        signature: sign(null, Buffer.from(hex, 'hex'), signer.privateKey).toString('base64'),
      }
    }
    yield Buffer.from(JSON.stringify(end) + '\n', 'utf8')
    onEnd?.(end)
  }
  const out = new PassThrough()
  const stages = [Readable.from(lines()), createGzip()]
  if (passphrase) stages.push(encryptor(passphrase, { logN }))
  pipeline(...stages, out, () => {})
  return out
}

/**
 * The archive's lines, verified, as an async generator of objects: the head first, then every
 * record. It returns (after the last record) with { end, signer }. Throws ArchiveError.
 * source: an async iterable of bytes (a request, a file stream).
 */
export async function* readArchive(source, { passphrase = null, limits = LIMITS } = {}) {
  const reader = byteReader(source)
  const first = await reader.read(HEADER_BYTES)
  let plain
  if (first.length >= MAGIC.length && first.subarray(0, MAGIC.length).equals(MAGIC)) {
    if (first.length < HEADER_BYTES) throw new ArchiveError('truncated', 'The archive ends early.')
    if (!passphrase) throw new ArchiveError('passphrase_required', 'This archive is encrypted. Give its passphrase.')
    checkPassphrase(passphrase)
    plain = decryptFrames(reader, first, passphrase)
  } else if (first.subarray(0, 2).equals(GZIP)) {
    plain = (async function* () {
      yield first
      for (;;) {
        const more = await reader.read(FRAME)
        if (!more.length) return
        yield more
      }
    })()
  } else {
    throw new ArchiveError('format_unknown', 'This is not a Slatebox team export.')
  }
  const gunzip = createGunzip()
  const input = Readable.from(plain)
  let failure = null
  pipeline(input, gunzip, (error) => {
    if (error) failure = error
  })
  const digest = createHash('sha256')
  let total = 0
  let count = 0
  let carry = Buffer.alloc(0)
  let end = null
  let head = null
  const take = (lineBytes) => {
    if (end) throw new ArchiveError('corrupt', 'The archive has lines after its end.')
    let record
    try {
      record = JSON.parse(lineBytes.toString('utf8'))
    } catch {
      throw new ArchiveError('corrupt', 'A line of the archive is not JSON.')
    }
    if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.t !== 'string')
      throw new ArchiveError('corrupt', 'A line of the archive is not a record.')
    if (record.t === 'end') {
      end = record
      return null
    }
    digest.update(lineBytes)
    digest.update('\n')
    count += 1
    if (!head) {
      if (record.t !== 'head' || record.format !== FORMAT)
        throw new ArchiveError('format_unknown', 'This is not a Slatebox team export.')
      if (record.version !== VERSION)
        throw new ArchiveError('version_unknown', `This server reads version ${VERSION} team exports; this one is version ${record.version}.`)
      head = record
    } else if (record.t === 'head') throw new ArchiveError('corrupt', 'The archive has two heads.')
    return record
  }
  try {
    for await (const chunk of gunzip) {
      total += chunk.length
      if (total > limits.totalBytes) throw new ArchiveError('too_large', 'The archive is larger than an import may be.')
      let data = carry.length ? Buffer.concat([carry, chunk]) : chunk
      let at
      while ((at = data.indexOf(0x0a)) !== -1) {
        const record = take(data.subarray(0, at))
        data = data.subarray(at + 1)
        if (record) yield record
      }
      if (data.length > limits.lineBytes) throw new ArchiveError('too_large', 'One line of the archive is too long.')
      carry = Buffer.from(data)
    }
    if (failure) throw failure
  } catch (error) {
    if (error instanceof ArchiveError) throw error
    throw new ArchiveError('corrupt', 'The archive is damaged.')
  } finally {
    // the reader stopped early (an error, or the caller stopped reading): stop the streams too
    input.destroy()
    gunzip.destroy()
  }
  if (carry.length) {
    const record = take(carry)
    if (record) yield record
  }
  if (!end) throw new ArchiveError('truncated', 'The archive ends early.')
  const hex = digest.digest('hex')
  if (end.lines !== count || end.digest !== hex) throw new ArchiveError('digest_mismatch', 'The archive does not match its own digest: it was changed or damaged.')
  let signer = null
  if (end.signer) {
    try {
      const der = Buffer.from(String(end.signer.publicKey), 'base64')
      const key = createPublicKey({ key: der, format: 'der', type: 'spki' })
      const ok = verify(null, Buffer.from(hex, 'hex'), key, Buffer.from(String(end.signer.signature), 'base64'))
      if (!ok) throw new Error('bad signature')
      signer = { fingerprint: publicKeyFingerprint(der) }
    } catch {
      throw new ArchiveError('signature_invalid', 'The archive signature does not match.')
    }
  }
  return { end, signer }
}
