// Photo notes (owner request 2026-11-27: "take pics with the mobile app via the phone and those drop
// into the slates"): slates.addPhoto, the phone app's one write.
//   - The photo is cleaned before it is stored (web/app/server/common/photo-clean.mjs): upright, at
//     most 2560 pixels, written again with no EXIF, so its GPS location never reaches the file store.
//   - Only a JPEG, PNG or WebP of at most 8 MB, at most 60 per person per hour, on a slate the caller
//     may edit (the same check as every other write).
//   - It lands as one add_nodes photo operation through the canvas save: at the middle of the
//     person's screen, live on every open copy. The phone app's photos are the person's own edit;
//     a personal token's are an agent's suggestion.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { crc32 as zlibCrc32 } from "node:zlib";
import { cleanPhoto, photoKind, PHOTO_CLEAN_LIMITS } from "../web/app/server/common/photo-clean.mjs";
import { dateFolder, uploadKey, uploadKeyFor } from "../web/app/server/common/upload-keys.mjs";
import { createHourlyLimit } from "../web/app/server/media/media-lookup.mjs";
import { createSuggestionStore } from "../web/app/server/agents/suggestions.mjs";
import { principalFromToken } from "../web/app/server/actions/principal.mjs";
import { holdsScope } from "../web/app/server/actions/registry.mjs";
import { apiAudiences, viewerClient, VIEWER_REDIRECTS, VIEWER_RESOURCE_PATH } from "../web/app/server/oauth/viewer.mjs";
import { makeExecWorld, memoryCollection } from "./exec-test-world.mjs";

const appRequire = createRequire(new URL("../web/app/package.json", import.meta.url));
const sharp = appRequire("sharp");
const ORIGIN = "https://slatebox.test";
const FILES = "https://files.slatebox.test";

// ---- fixtures ---------------------------------------------------------------------------------

// A phone's JPEG: taken sideways (EXIF orientation 6), with the camera's make and a GPS location.
async function phoneJpeg({ width = 80, height = 40 } = {}) {
  return sharp({ create: { width, height, channels: 3, background: "#c33" } })
    .withExif({
      IFD0: { Make: "TestPhone", Model: "Camera 1" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" },
    })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
}
const png = (alpha) => sharp({ create: { width: 30, height: 20, channels: alpha ? 4 : 3, background: alpha ? { r: 0, g: 0, b: 0, alpha: 0.5 } : "#3c3" } }).png().toBuffer();

// What a JPEG's EXIF holds, read without a library: the IFD0 tags, and whether it points at a GPS IFD (tag 0x8825).
export function exifTags(jpeg) {
  for (let at = 2; at + 4 < jpeg.length;) {
    if (jpeg[at] !== 0xff) return null;
    const marker = jpeg[at + 1];
    const length = jpeg.readUInt16BE(at + 2);
    if (marker === 0xe1 && jpeg.subarray(at + 4, at + 10).toString("latin1") === "Exif\0\0") {
      const tiff = at + 10;
      const little = jpeg.subarray(tiff, tiff + 2).toString("latin1") === "II";
      const u16 = (o) => (little ? jpeg.readUInt16LE(o) : jpeg.readUInt16BE(o));
      const u32 = (o) => (little ? jpeg.readUInt32LE(o) : jpeg.readUInt32BE(o));
      const ifd = tiff + u32(tiff + 4);
      const tags = [];
      for (let i = 0; i < u16(ifd); i++) tags.push(u16(ifd + 2 + i * 12));
      return { tags, gps: tags.includes(0x8825) };
    }
    if (marker === 0xda) return null;
    at += 2 + length;
  }
  return null;
}

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

// The app's photo service (server/actions/mount.js) over memory: the real cleaning, a file store that
// keeps what it is given, and the hourly limit on a clock the test sets.
function photoService({ perHour = 60 } = {}) {
  let clock = 0;
  let n = 0;
  const stored = new Map();
  const removed = [];
  return {
    stored,
    removed,
    tick: (ms) => (clock += ms),
    service: {
      clean: (bytes) => cleanPhoto(bytes),
      async store({ userId, bytes, type, ext, dryRun = false }) {
        const key = uploadKey(userId, `R${String(++n).padStart(16, "0")}`, ext);
        if (!dryRun) stored.set(key, { bytes, type });
        return { key, url: `${FILES}/${key}` };
      },
      async remove(key) {
        removed.push(key);
        stored.delete(key);
      },
      limit: createHourlyLimit({ perHour, now: () => clock }),
    },
  };
}

function world({ grants = [] } = {}) {
  const w = makeExecWorld({ grants });
  const photos = photoService();
  w.deps.photos = photos.service;
  w.deps.photoAllowed = (url) => typeof url === "string" && url.startsWith(`${FILES}/`);
  let n = 0;
  w.deps.suggestions = createSuggestionStore({
    collection: memoryCollection(),
    controls: memoryCollection(),
    identify: w.presence.identify,
    applyPlan: async () => { throw new Error("not used"); },
    findName: async () => "Ada",
    newId: () => `s${++n}`,
  });
  w.deps.agentOptions = { editDirectly: () => false };
  // Who may keep or discard: the slate's owner (scripts/agent-suggestions.test.mjs's world).
  w.deps.resolveSlateForUser = async (shareId, userId) => {
    const slate = w.slate(shareId);
    if (!slate) return null;
    const own = slate.userId === userId;
    return { slate, canRead: own, canEdit: own };
  };
  return Object.assign(w, { photos });
}

// A viewer token's principal, as /api/v1 makes it (server/actions/mount.js).
async function viewerPrincipal(w, { userId = "owner", scopes = ["slates:read", "slates:add-photo"] } = {}) {
  const { id } = await w.mint(scopes, userId);
  const viewer = viewerClient({ mobile: { redirects: [...VIEWER_REDIRECTS] } });
  const audiences = apiAudiences({ origin: ORIGIN, viewer });
  return principalFromToken({ token: { _id: id, kind: "oauth", userId, name: "Slatebox viewer", scopes, resource: ORIGIN + VIEWER_RESOURCE_PATH } }, { audiences });
}

const person = (userId = "owner") => ({ kind: "person", userId, tokenId: null, tokenName: null, scopes: ["slates:read", "slates:write"] });
const add = (w, principal, input) => w.registry.run(principal, "slates.addPhoto", { shareId: "demo", ...input });
const status = (promise) => promise.then((r) => r.status, (e) => e.status);

// ---- cleaning ---------------------------------------------------------------------------------

test("cleaning: a phone JPEG with a GPS location is stored upright with no EXIF at all", async () => {
  const input = await phoneJpeg();
  assert.equal(exifTags(input).gps, true, "the fixture carries a GPS location");
  assert.equal((await sharp(input).metadata()).orientation, 6);
  const out = await cleanPhoto(input);
  assert.equal(out.type, "image/jpeg");
  assert.equal(out.ext, "jpg");
  // Turned upright: the sideways 80 by 40 is stored 40 by 80, with no orientation left to apply.
  assert.deepEqual([out.width, out.height], [40, 80]);
  const meta = await sharp(out.bytes).metadata();
  assert.equal(meta.exif, undefined, "no EXIF");
  assert.equal(meta.xmp, undefined, "no XMP");
  assert.equal(meta.iptc, undefined, "no IPTC");
  assert.equal(meta.orientation, undefined);
  assert.equal(exifTags(out.bytes), null, "no EXIF segment in the stored bytes");
  assert.equal(out.bytes.includes(Buffer.from("TestPhone")), false);
  assert.doesNotMatch(readFileSync(new URL("../web/app/server/common/photo-clean.mjs", import.meta.url), "utf8"), /\.withMetadata\(|\.keepExif\(|\.withExif/);
});

test("cleaning: a see-through PNG stays PNG, an opaque one becomes JPEG, a large photo fits 2560", async () => {
  const clear = await cleanPhoto(await png(true));
  assert.equal(clear.type, "image/png");
  assert.equal((await sharp(clear.bytes).metadata()).hasAlpha, true);
  assert.equal((await cleanPhoto(await png(false))).type, "image/jpeg");
  const big = await cleanPhoto(await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#33c" } }).jpeg().toBuffer());
  assert.deepEqual([big.width, big.height], [2560, 853]);
  const webp = await cleanPhoto(await sharp({ create: { width: 20, height: 20, channels: 3, background: "#333" } }).webp().toBuffer());
  assert.equal(webp.type, "image/jpeg");
});

// A PNG's chunks by type (IHDR, tEXt, IDAT ...), in order.
function pngChunks(bytes) {
  const types = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(at);
    types.push(bytes.subarray(at + 4, at + 8).toString("latin1"));
    at += 12 + length;
  }
  return types;
}
// The PNG with chunks of its own put in after IHDR (each with its CRC).
function withPngChunks(bytes, chunks) {
  const ihdrEnd = 8 + 12 + bytes.readUInt32BE(8);
  const made = chunks.map(([type, data]) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(data, "latin1")]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length - 4);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlibCrc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  });
  return Buffer.concat([bytes.subarray(0, ihdrEnd), ...made, bytes.subarray(ihdrEnd)]);
}

test("cleaning: a PNG's text chunks (a title, an author, an ImageMagick EXIF profile with a GPS location) are never stored", async () => {
  const input = withPngChunks(await png(true), [
    ["tEXt", "Title\0Home, 12 Elm Street"],
    ["tEXt", "Author\0Jane Doe"],
    ["tEXt", "Raw profile type exif\0\nexif\n  20\nGPSLatitude 51.5 GPSLongitude -0.12\n"],
    ["iTXt", "XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta><exif:GPSLatitude>51,30N</exif:GPSLatitude></x:xmpmeta>"],
  ]);
  assert.ok(pngChunks(input).includes("tEXt") && pngChunks(input).includes("iTXt"), "the fixture carries text chunks");
  const out = await cleanPhoto(input);
  assert.equal(out.type, "image/png");
  assert.deepEqual(pngChunks(out.bytes).filter((type) => !["IHDR", "pHYs", "IDAT", "IEND"].includes(type)), [], "only the picture's own chunks (pHYs: its density, which the encoder writes)");
  for (const words of ["Elm Street", "Jane Doe", "GPSLatitude", "Raw profile"]) assert.equal(out.bytes.includes(Buffer.from(words)), false, words);
  // A JPEG keeps nothing either: no APP segment past the JFIF header, no comment.
  const jpeg = await cleanPhoto(withPngChunks(await png(false), [["tEXt", "Comment\0GPS 51.5,-0.12"]]));
  assert.equal(jpeg.bytes.includes(Buffer.from("GPS 51.5")), false);
});

test("cleaning: a 16-bit PNG, a grey one with see-through parts and a CMYK JPEG are read too", async () => {
  const sixteen = await sharp({ create: { width: 20, height: 10, channels: 4, background: { r: 10, g: 200, b: 30, alpha: 0.5 } } }).toColourspace("rgb16").png().toBuffer();
  assert.equal((await sharp(sixteen).metadata()).depth, "ushort", "the fixture is 16-bit");
  const deep = await cleanPhoto(sixteen);
  assert.deepEqual([deep.type, deep.width, deep.height], ["image/png", 20, 10]);
  const grey = await cleanPhoto(await sharp({ create: { width: 12, height: 8, channels: 4, background: { r: 90, g: 90, b: 90, alpha: 0.4 } } }).toColourspace("b-w").png().toBuffer());
  assert.equal(grey.type, "image/png");
  assert.equal((await sharp(grey.bytes).metadata()).hasAlpha, true);
  const cmyk = await cleanPhoto(await sharp({ create: { width: 16, height: 16, channels: 3, background: "#c33" } }).toColourspace("cmyk").jpeg().toBuffer());
  assert.deepEqual([cmyk.type, cmyk.width, cmyk.height], ["image/jpeg", 16, 16]);
  assert.equal((await sharp(cmyk.bytes).metadata()).space, "srgb");
});

test("cleaning: only a JPEG, PNG or WebP by its first bytes is read; anything else is refused before sharp sees it", async () => {
  const gif = Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04", "latin1");
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  const pdf = Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj", "latin1");
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic\0\0\0\0mif1heic")]);
  for (const [name, bytes] of Object.entries({ gif, svg, pdf, heic })) {
    assert.equal(photoKind(bytes), null, name);
    await assert.rejects(cleanPhoto(bytes), (error) => error.status === 415 && error.message === "Send a JPEG, PNG or WebP photo.", name);
  }
  // A JPEG header on bytes that are not a picture.
  await assert.rejects(cleanPhoto(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 7)])), (error) => error.status === 415);
  await assert.rejects(cleanPhoto(Buffer.alloc(PHOTO_CLEAN_LIMITS.maxBytes + 1, 0xff)), (error) => error.status === 413);
});

// ---- the action -------------------------------------------------------------------------------

test("one action: POST /slates/{shareId}/photos, the narrow slates:add-photo scope, a 12 MB body, save and preview", async () => {
  const { createAppRegistry } = await import("../web/app/server/actions/index.mjs");
  const action = createAppRegistry().get("slates.addPhoto");
  assert.deepEqual(action.mounts.http, { method: "POST", path: "/slates/{shareId}/photos", operationId: "addPhotoNote" });
  assert.equal(action.mounts.ddp, false, "the web editor has its own upload; this is the phone's door");
  assert.equal(action.kind, "write");
  assert.equal(action.toolset, "slates");
  assert.equal(action.scope, "slates:add-photo");
  assert.deepEqual(action.principals, ["person", "agent"]);
  assert.deepEqual(action.modes, ["save", "preview"]);
  assert.equal(action.idempotency, "optional");
  assert.equal(action.bodyLimit, "12mb");
  // In the API's document; never an exec method or an MCP tool (a photo is more than a script or an MCP call carries).
  const openapi = JSON.parse(readFileSync(new URL("../web/app/server/actions/generated/openapi.json", import.meta.url), "utf8"));
  assert.equal(openapi.paths["/slates/{shareId}/photos"].post.operationId, "addPhotoNote");
  const generated = readFileSync(new URL("../web/app/server/actions/generated/slatebox.d.ts", import.meta.url), "utf8");
  assert.doesNotMatch(generated, /function addPhoto\(/);
  assert.equal(readFileSync(new URL("../packages/slatebox-mcp/generated/slatebox.d.ts", import.meta.url), "utf8"), generated);
});

test("the viewer's photo is saved as the person's own edit, at the middle of the screen, live through the save core", async (t) => {
  const w = world();
  t.after(() => w.close());
  const principal = await viewerPrincipal(w);
  assert.equal(principal.firstParty, "viewer");
  const before = w.slate("demo");
  const revision = before.revision ?? 0;
  const result = await add(w, principal, { photo: b64(await phoneJpeg()), center: { x: 500, y: 300 }, alt: "  The whiteboard  " });
  assert.equal(result.status, 201);
  const body = result.body;
  assert.equal(body.outcome, "saved");
  assert.ok(body.revision > revision, "the slate's revision went up");
  const node = w.slate("demo").nodes.find((n) => n.options.id === body.nodeId);
  assert.ok(node, "the note is saved");
  // A 40 by 80 photo is a 160 by 320 note, its middle at the screen's middle.
  assert.deepEqual([node.options.width, node.options.height], [160, 320]);
  assert.deepEqual([node.options.xPos, node.options.yPos], [500 - 80, 300 - 160]);
  assert.equal(node.options.image, body.url);
  assert.equal(node.options.imageFit, "cover");
  assert.deepEqual(node.options.photo, { url: body.url, width: 40, height: 80, alt: "The whiteboard" });
  assert.deepEqual([body.width, body.height], [40, 80]);
  // Stored once, cleaned, under the editor's upload names.
  assert.equal(w.photos.stored.size, 1);
  const [[key, file]] = [...w.photos.stored];
  assert.equal(body.url, `${FILES}/${key}`);
  assert.match(key, new RegExp(`^${dateFolder()}/u_owner_[A-Za-z0-9]{17}\\.jpg$`));
  assert.equal(file.type, "image/jpeg");
  assert.equal(exifTags(file.bytes), null, "the stored photo has no EXIF");
  // The phone app is not an agent: no agent pointer on the slate, nothing waiting as a suggestion.
  assert.equal(w.presenceRows.docs.size, 0);
  assert.deepEqual(await w.deps.suggestions.list(before._id), []);
});

test("without a center the photo goes beside the slate's notes; a personal token's photo is an agent's suggestion", async (t) => {
  const w = world();
  t.after(() => w.close());
  const viewer = await viewerPrincipal(w);
  const placed = (await add(w, viewer, { photo: b64(await png(false)) })).body;
  const note = w.slate("demo").nodes.find((n) => n.options.id === placed.nodeId).options;
  const overlaps = w.slate("demo").nodes.filter((n) => n.options.id !== placed.nodeId).some(({ options: o }) =>
    note.xPos < o.xPos + o.width && note.xPos + note.width > o.xPos && note.yPos < o.yPos + o.height && note.yPos + note.height > o.yPos);
  assert.equal(overlaps, false);

  const agent = await w.principalFor(["slates:read", "slates:write"]);
  const count = w.slate("demo").nodes.length;
  const suggested = await add(w, agent, { photo: b64(await png(false)), center: { x: 0, y: 0 } });
  assert.equal(suggested.status, 202);
  assert.equal(suggested.body.outcome, "suggested");
  assert.ok(suggested.body.suggestion, "a suggestion people on the slate keep or discard");
  assert.equal(w.slate("demo").nodes.length, count, "nothing saved yet");
  assert.ok(w.presenceRows.docs.size > 0, "the agent shows on the slate");
});

// 2026-11-28, on test.slatebox.com: a personal token's photo, kept with Keep all, landed as a plain
// rectangle with no picture (on screen and in the stored slate), and the stored photo was orphaned.
test("a personal token's photo, kept by a person, is the photo note: the picture, its size and its words", async (t) => {
  const w = world();
  t.after(() => w.close());
  const agent = await w.principalFor(["slates:read", "slates:write"]);
  const suggested = await add(w, agent, { photo: b64(await phoneJpeg()), center: { x: 500, y: 300 }, alt: "The whiteboard" });
  assert.equal(suggested.body.outcome, "suggested");
  const [item] = suggested.body.suggestion.items;
  assert.equal(item.node.options.image, suggested.body.url, "the ghost shows the photo");
  const kept = await w.registry.run(person(), "suggestions.decide", { shareId: "demo", decision: "keep", actionId: suggested.body.suggestion.actionId });
  assert.equal(kept.body.kept.length, 1);
  assert.deepEqual(kept.body.refused, []);
  const node = w.slate("demo").nodes.find((n) => n.options.id === suggested.body.nodeId);
  assert.ok(node, "the note is saved");
  assert.equal(node.options.image, suggested.body.url, "the kept note shows the photo");
  assert.equal(node.options.imageFit, "cover");
  assert.deepEqual([node.options.imageOrigWidth, node.options.imageOrigHeight], [40, 80]);
  assert.deepEqual(node.options.photo, { url: suggested.body.url, width: 40, height: 80, alt: "The whiteboard" });
  assert.equal(node.options.text, "");
  // Where and how large the ghost was.
  assert.deepEqual([node.options.width, node.options.height], [160, 320]);
  assert.deepEqual([node.options.xPos, node.options.yPos], [500 - 80, 300 - 160]);
  // The stored photo is the one the note points at: nothing removed, nothing orphaned.
  assert.equal(w.photos.stored.size, 1);
  assert.deepEqual(w.photos.removed, []);
  assert.equal(`${FILES}/${[...w.photos.stored.keys()][0]}`, node.options.image);
});

test("preview stores nothing; a save that fails removes the stored photo", async (t) => {
  const w = world();
  t.after(() => w.close());
  const principal = await viewerPrincipal(w);
  const count = w.slate("demo").nodes.length;
  const preview = await add(w, principal, { photo: b64(await png(false)), mode: "preview" });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.mode, "preview");
  assert.equal(preview.body.outcome, undefined);
  assert.equal(w.photos.stored.size, 0);
  assert.equal(w.slate("demo").nodes.length, count);

  const save = w.deps.saveCore.save;
  w.deps.saveCore.save = async () => { throw Object.assign(new Error("The database is away."), { code: "boom" }); };
  await assert.rejects(add(w, principal, { photo: b64(await png(false)) }), (e) => e.status === 500);
  w.deps.saveCore.save = save;
  assert.equal(w.photos.stored.size, 0, "nothing left in the file store");
  assert.equal(w.photos.removed.length, 1);
});

test("refusals: too large (413), not a JPEG, PNG or WebP (415), not base64 (400), the 61st in an hour (429)", async (t) => {
  const w = world();
  t.after(() => w.close());
  const principal = await viewerPrincipal(w);
  await assert.rejects(add(w, principal, { photo: b64(Buffer.alloc(8 * 1024 * 1024 + 1, 0xff)) }), (e) => e.status === 413 && e.message === "Photos must be under 8 MB.");
  for (const bytes of [Buffer.from("GIF89a" + "x".repeat(40)), Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>" + " ".repeat(20)), Buffer.from("%PDF-1.7" + " ".repeat(40)),
    Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic\0\0\0\0mif1heic")])]) {
    await assert.rejects(add(w, principal, { photo: b64(bytes) }), (e) => e.status === 415 && e.message === "Send a JPEG, PNG or WebP photo.");
  }
  await assert.rejects(add(w, principal, { photo: "data:image/jpeg;base64,AAAA" }), (e) => e.status === 400);
  assert.equal(w.photos.stored.size, 0);

  const limited = world();
  t.after(() => limited.close());
  const ada = await viewerPrincipal(limited);
  const small = b64(await png(false));
  // Six refused photos above already counted in w; a fresh world counts from zero.
  for (let i = 0; i < 60; i++) assert.equal(await status(add(limited, ada, { photo: small, mode: "preview" })), 200, `photo ${i + 1}`);
  await assert.rejects(add(limited, ada, { photo: small }), (e) => e.status === 429);
  limited.photos.tick(61 * 60 * 1000);
  assert.equal(await status(add(limited, ada, { photo: small, mode: "preview" })), 200, "an hour later");
});

test("who may add: the slate's editors only, the same check as every other write", async (t) => {
  const w = world({ grants: [
    { slateId: "slate-5", type: "public", userId: "reader", slateAccessPermissionId: "READ" },
    { slateId: "slate-5", type: "public", userId: "critic", slateAccessPermissionId: "COMMENT" },
    { slateId: "slate-5", type: "public", userId: "editor", slateAccessPermissionId: "EDIT" },
  ] });
  t.after(() => w.close());
  w.users.docs.push({ _id: "reader" }, { _id: "critic" }, { _id: "editor" });
  const photo = b64(await png(false));
  for (const who of ["reader", "critic"]) {
    const principal = await viewerPrincipal(w, { userId: who });
    await assert.rejects(add(w, principal, { shareId: "open", photo }), (e) => e.status === 403, who);
  }
  assert.equal(await status(add(w, await viewerPrincipal(w, { userId: "editor" }), { shareId: "open", photo })), 201);
  const stranger = await viewerPrincipal(w, { userId: "other" });
  await assert.rejects(add(w, stranger, { shareId: "nowhere", photo }), (e) => e.status === 404);
  // Whatever slates.applyOperations allows or refuses, this does too.
  const agent = await w.principalFor(["slates:read", "slates:write"]);
  const plan = { message: "x", operations: [{ kind: "add_nodes", count: 1, shape: "rectangle", text: "x" }] };
  for (const shareId of ["theirs", "nowhere"]) {
    const edit = await status(w.registry.run(agent, "slates.applyOperations", { shareId, expectedRevision: 0, plan }));
    assert.equal(await status(add(w, agent, { shareId, photo })), edit, shareId);
  }
  // A token without the photo scope is refused before anything is read.
  const reader = await viewerPrincipal(w, { scopes: ["slates:read"] });
  await assert.rejects(add(w, reader, { photo }), (e) => e.status === 403 && e.code === "insufficient_scope");
});

test("scopes: slates:write holds slates:add-photo; slates:add-photo holds nothing else", () => {
  assert.equal(holdsScope({ scopes: ["slates:write"] }, "slates:add-photo"), true);
  assert.equal(holdsScope({ scopes: ["slates:add-photo"] }, "slates:add-photo"), true);
  assert.equal(holdsScope({ scopes: ["slates:add-photo"] }, "slates:write"), false);
  assert.equal(holdsScope({ scopes: ["slates:add-photo"] }, "slates:read"), false);
  assert.equal(holdsScope({ scopes: ["slates:read"] }, "slates:add-photo"), false);
});

test("a plan's photo must be one Slatebox stored: another host's picture is refused", async (t) => {
  const w = world();
  t.after(() => w.close());
  const agent = await w.principalFor(["slates:read", "slates:write"]);
  const edit = (url) => w.registry.run(agent, "slates.applyOperations", { shareId: "demo", expectedRevision: w.slate("demo").revision ?? 0,
    plan: { message: "Photo", operations: [{ kind: "add_nodes", count: 1, photo: { url, width: 10, height: 10 } }] } });
  await assert.rejects(edit("https://evil.example/pixel.jpg"), (e) => e.code === "invalid_operation_plan" && /photo Slatebox stored/.test(e.message));
  // A stored one is taken (an agent's edit: a suggestion for people on the slate).
  assert.equal(await status(edit(`${FILES}/2026/11/27/u_owner_R0000000000000001.jpg`)), 202);
});

test("one name for every upload: the editor's and the phone's, which images.removeImage knows as the person's", () => {
  const user = "Ab3dEf6hIj9kLm2nP";
  const key = uploadKey(user, "Zx8cVb7nMq6wEr5tY", "jpg", new Date(2026, 10, 27));
  assert.equal(key, `2026/11/27/u_${user}_Zx8cVb7nMq6wEr5tY.jpg`);
  assert.equal(uploadKeyFor(key, user), key);
  assert.equal(uploadKeyFor(key, "SomeoneElse123456"), null);
  assert.equal(uploadKeyFor(key.replace(".jpg", ".svg"), user), null);
  const read = (path) => readFileSync(new URL(`../web/app/server/${path}`, import.meta.url), "utf8");
  assert.match(read("common/fileStore.js"), /export const newUploadKey = \(userId, ext\) => uploadKey\(userId, Random\.id\(\), ext\)/);
  assert.match(read("sbImages.js"), /const key = newUploadKey\(user\._id, kind\.ext\)/);
  assert.match(read("sbImages.js"), /export const uploadKeyOf = \(url, userId\) => uploadKeyFor\(storedFileKey\(url\), userId\)/);
  // The app wires the real service: cleaned, stored in the one file store, removed when its note is not saved.
  const mount = read("actions/mount.js");
  assert.match(mount, /photos: \{\s*clean: \(bytes\) => cleanPhoto\(bytes\),/);
  assert.match(mount, /const key = newUploadKey\(userId, ext\)/);
  assert.match(mount, /storeFile\(\{ body: bytes, key, contentType: type \}\)/);
  assert.match(mount, /remove: \(key\) => deleteStoredFile\(key\)/);
  assert.match(mount, /limit: createHourlyLimit\(\{ perHour: PHOTO_LIMITS\.perHour \}\)/);
});
