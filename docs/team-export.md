# Team export format (version 2)

Team settings › Export everything writes one file holding everything a team owns. Any Slatebox
server imports it (Admin tools › Import a team export, or the `teamImports.*` actions). The format
is open: this page describes every part of it. The code is `web/app/server/team-export/`.

## The file

- **Lines.** The content is NDJSON: one JSON object per line, in the order below.
- **Compression.** The lines are always gzipped.
- **Encryption.** When the person gives a passphrase (Team settings always asks for one), the
  gzip stream is encrypted:
  - Header (49 bytes): `SBXTEAM\x02`, then the key-derivation id (`1` = scrypt) and log2 N (15),
    a 16-byte random salt, a 7-byte random nonce prefix, and a 16-byte key check
    (HMAC-SHA256 of the key over `"slatebox team export key check"` and the header so far).
  - Key: scrypt(passphrase NFKC, salt, N, r = 8, p = 1), 32 bytes.
  - A passphrase is 12 to 1,024 characters. One that encrypts a file may not start or end with
    white space or hold control characters, so it can always be typed and sent back to import.
  - Frames: a 1-byte last flag, a 4-byte big-endian length, then AES-256-GCM ciphertext and
    its 16-byte tag. Each frame holds up to 64 KiB. The nonce is the prefix, the frame number
    (4 bytes, big-endian) and the last flag. Every frame authenticates the whole header.
  - What this catches: a reordered, dropped, cut-off or moved frame fails to decrypt. A wrong
    passphrase fails the key check.
- **Integrity.** The last line carries:
  - the SHA-256 of every earlier line (each with its newline);
  - the line count;
  - when the server has a signing key, an Ed25519 signature of that digest, with the public
    key and its fingerprint (first 32 hex characters of the SHA-256 of the SPKI DER).

## Lines

| Line | Holds |
|---|---|
| `{"t":"head"}` | `format: "slatebox-team-export"`, `version: 2`, `createdAt`, `source {instance, name, team}`, `encrypted` |
| `{"t":"doc","s":"team"}` | `_id`, `name`, `createdOn` |
| `{"t":"doc","s":"members"}` | one per person: `_id`, `email`, `emailVerified`, `firstName`, `lastName`, `owner`, `roles` (team claims), `createdAt` |
| `{"t":"doc","s":"index"}` | `slates: [{id, shareId}]` for every slate that follows |
| `{"t":"file"}` + `{"t":"chunk"}`… | an uploaded file the slates, the brand kit, the presentations or the library items use: `id`, `url`, `ext`, `size`, `sha256`; then its bytes as base64 in chunks of up to 512 KiB |
| `{"t":"doc","s":"slates","h":…}` | a slate, with its boards, smart components and board rules; `h` is its content hash (below) |
| `{"t":"doc","s":"versions"}` | up to 20 recent saved versions per slate; `snapshot` is the whole slate as it was, as one JSON string |
| `{"t":"doc","s":"events"}` | up to 500 event-log rows per slate from the last 90 days |
| `{"t":"doc","s":"comments"}` | comments on the slates |
| `{"t":"doc","s":"presentations"}` | presentations of the slates |
| `{"t":"doc","s":"presentationChats"}` | the conversations that made them |
| `{"t":"doc","s":"links"}` | `slateId`, `type` (private, unlisted, public), `userId` (or null for the published link), `role` |
| `{"t":"doc","s":"settings"}` | team settings such as branding |
| `{"t":"doc","s":"ai"}` | `connections [{name, provider, baseUrl, model, hadKey}]`, `use` (which connection each feature uses) |
| `{"t":"doc","s":"tokens"}` | `userId`, `name`, `scopes`, `createdAt`, `revoked` |
| `{"t":"doc","s":"library"}` | a shared-library item a member wrote: `_id`, `kind`, `authorId`, `title`, `summary`, `description`, `category`, `synonyms`, `status`, `sourceShareId`, `content` (the published version, else the one waiting for review, else the draft). Built-in items never travel |
| `{"t":"skip"}` | something left out, and why: `another_team` (a file another team uploaded), `missing`, `too_large` |
| `{"t":"end"}` | `lines`, `bytes`, `counts`, `digest`, `signer {alg, publicKey, fingerprint, signature}` |

**Never in a file:** passwords and their hashes, sessions and sign-in links, API, MCP and exec token
secrets, hashes or prefixes, AI and call keys or their ciphers, published-link keys, and payment,
wallet and meter records. These fields are removed wherever they appear (`format.mjs` `scrubSecrets`).

**What counts as the team's:**
- the team document;
- the people whose team it is (never guests);
- the slates whose team it is, and what belongs to those slates;
- a file a member uploaded, or a picture of one of the team's slates;
- a file the team's slates, brand kit, presentations or library items use whose uploader has no
  account on the server any more;
- the library items its members wrote.

A slate that shows another team's file keeps that file's address, and the file is not copied.

**Content hash:** the SHA-256 of the slate's canonical JSON (keys sorted). These are left out:
- its ids (including the share address its options repeat), owner, team, dates, revision,
  visibility, search and directory flags.

An importer also takes the hash of a slate whose options' share address was hashed with it.

Two kinds of address are replaced before hashing:
- files are named `sbx-file:<sha256>`;
- links to other slates become `/canvas/*`.

So a slate whose files and links moved to new addresses still hashes the same.

## Limits

| What | Limit |
|---|---|
| Whole file, uncompressed | 10 GB |
| One slate | 15 MB |
| One file | 50 MB |
| Any other record | 2 MB |
| People | 2,000 |
| Slates | 20,000 |

The reader enforces the same limits while it decompresses. A file that expands past them is refused.

## Import

The file is treated as hostile.

- **New ids.** Every document gets a new id, and every slate a new share address.
  `teamImportMap {importId, section, sourceId, newId}` is the only link back to the source.
- **Ownership.** Nothing is looked up or overwritten by a source id. Owners and teams are set by
  the importer.
- **Hidden team.** The import makes a new hidden team (`hidden: true` until it is confirmed). Only
  administrators see it, in Admin tools › Import a team export. The team is published to no one, and the
  administrators' user search leaves out its people. (Limiting it to named administrators comes
  with the move to Cloud.)
- **People** become placeholders:
  - no sign-in and no email address an account could be found by;
  - roles of that team only.
  - A person record with sign-in secrets, a server-wide role or unknown fields is refused.
- **Slates:**
  - Slates arrive private. Their visibility comes back when the import is confirmed.
  - Template and directory flags are dropped.
  - Every board rule arrives switched off.
  - Links between imported slates and to imported files are rewritten.
  - Versions are read as slates: the ids and links inside them are rewritten, and each names its
    new slate and share address. Restoring a version keeps the open slate's own id and share
    address.
- **Files** are checked by their first bytes, their size and their hash.
- **Published links** get new keys.
- **AI connections** arrive without keys, and only when their address is public (HTTPS, not
  localhost, not a private or link-local address).
- **Tokens** are never made. The report lists them to make again.
- **Library items** arrive as their authors' drafts. Nothing reaches the receiving server's
  library until its own review approves it. The report lists each with the status it had.
- **Event log.** The event log starts again: the source's events stay in the file.
- **Failure.** A refused file removes everything the import wrote.
- **Confirm or discard.** Confirm makes the team live. Discard deletes everything the import wrote.
- **Invitations.** With "invite", confirm emails each person whose address the source had
  verified and no account here uses, in any letter case. The answer lists:
  - `needsConsent`: addresses an account here already uses. That person has to agree to move.
  - `unverified`: addresses the source had not verified. An administrator checks each one and
    invites it with `teamImports.invite` (Admin tools shows a button per address).
  - People who are not invited stay placeholders. Team pages show them as "Not yet invited".
- **Unconfirmed imports.** An import still pending after 14 days is discarded.

## Moves

A move is an import that the team's own owner makes, without an administrator of the receiving
server. Use it to move a team from your own server to Slatebox Cloud, or back
(`npx slatebox migrate --to cloud`, `npx slatebox import --from cloud`).

- **Who.** A signed-in person who owns their team on the receiving server, or who is in no team
  yet. Only they can read, confirm or discard their move. One move waits at a time.
- **Where it lands.** In no team, the moved team becomes theirs. As a team owner, it joins their
  team.
- **Pending.** The archive lands in the same hidden team as an import, with the same checks.
- **Confirm (`teamMove.confirm`):**
  - The mover takes the seat of the moved person with their verified address, or else of the
    moved owner. Slates, comments, presentations and library drafts of that seat become theirs.
  - Into a team, a moved person whose address belongs to someone already in that team takes
    that person's seat. The team's own brand kit, agent choices and connection names are kept;
    the moved ones are used only where the team has none.
  - Nobody else gets an account they can sign in to. With `invite`, the other people whose
    address the source had verified get the email to claim their placeholder, as for an import.
- **The same archive twice** (same digest, same person) answers with the first move, and the
  second copy is removed.
- **Limit.** A move holds at most 2 GB uncompressed.

## Addresses

`team.export` and `teamImports.start` return a one-time address:
- an export address lasts 15 minutes;
- an import address lasts 1 hour.

Each address works once, only for the person it was issued to, and is stored by its hash.

- `POST /team-transfer/export/<ticket>`: the file.
  - The passphrase goes in the form or JSON field `passphrase`, or in a header (below).
  - With no passphrase, the file is signed but not encrypted.
- `POST /team-transfer/import/<ticket>`: send the file as `application/octet-stream`.
  - The passphrase goes in a header (below).
  - The answer is the import report.
- `POST /team-transfer/move/<ticket>` (from `teamMove.start`, 1 hour): the same for a move. It
  answers 201 with the report, or 200 with the first move when this archive was moved already.

**Passphrase headers:**
- `Slatebox-Export-Passphrase-Base64`: base64url of the passphrase's UTF-8 bytes. Use it for any
  passphrase; a header cannot carry text that is not ASCII.
- `Slatebox-Export-Passphrase`: the passphrase as it is, for a plain ASCII passphrase.
- When both are sent, the base64 header is used.

**Token scopes:**
- `team:export` lets a token export (a team admin's token).
- `team:import` lets a token import, list, read, confirm, invite and discard imports (an
  administrator's token).
- `team:move` lets a token start, list, read, confirm and discard its person's own moves. Exec
  scripts cannot call these: a script cannot send an archive.
