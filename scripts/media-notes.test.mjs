// Video notes (owner decision 5, 2026-11-23): a YouTube, Vimeo or Loom address becomes a note that
// shows a poster stored in the app's own image store and plays where it sits when pressed.
//   - The server looks a video up only at the host's fixed oEmbed address and fetches the poster
//     only from the host's own picture server, over https, to public addresses (safe-fetch.mjs).
//   - media.lookup and slates.addMedia are one action each: a Meteor method, an /api/v1 route, an
//     exec method and an MCP tool, with the same checks (exec everywhere).
//   - Still pictures of a slate (cards, gallery tiles, version pictures, brand previews) draw the
//     poster and never play (the engine's mediaPlayback: false); the live canvas hands pasted
//     addresses to the server lookup (onMediaRequested).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkUrl, publicLookup, safeFetch, FetchRefused } from "../web/app/server/common/safe-fetch.mjs";
import { MEDIA_HOSTS, createMediaLookup, createHourlyLimit, posterAllowedFor, posterKey, sniffImage } from "../web/app/server/media/media-lookup.mjs";
import { makeExecWorld } from "./exec-test-world.mjs";

const YT = "dQw4w9WgXcQ";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const json = (value) => ({ bytes: Buffer.from(JSON.stringify(value)), contentType: "application/json" });

// A video host as the lookup sees it: oEmbed answers and picture bytes, each call recorded.
function fakeHost({ oembed = {}, poster = JPEG, failOembed = false } = {}) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const host = new URL(url).hostname;
    if (!options.allowHosts.includes(host)) throw new FetchRefused("That address is not one this fetch may reach.");
    if (url.includes("oembed")) {
      if (failOembed) throw new FetchRefused("The address answered 404.");
      return json({ title: "Launch demo", author_name: "Slatebox", thumbnail_url: `https://i.ytimg.com/vi/${YT}/hqdefault.jpg`, thumbnail_width: 480, thumbnail_height: 360, ...oembed });
    }
    return { bytes: poster, contentType: "image/jpeg" };
  };
  const stored = [];
  const storePoster = async ({ key, body, contentType }) => {
    stored.push({ key, size: body.length, contentType });
    return `https://files.slatebox.test/${key}`;
  };
  return { calls, fetch, stored, storePoster };
}

test("safeFetch: a host list holds on the first request and on every redirect", () => {
  const hosts = MEDIA_HOSTS.youtube.oembedHosts;
  assert.equal(checkUrl("https://www.youtube.com/oembed?url=x", hosts).hostname, "www.youtube.com");
  for (const url of ["https://evil.example/oembed", "https://www.youtube.com.evil.example/", "https://169.254.169.254/latest/meta-data", "https://10.0.0.5/", "http://www.youtube.com/oembed"]) {
    assert.throws(() => checkUrl(url, hosts), FetchRefused, url);
  }
  // Without a list the rule is the old one: any public https address.
  assert.equal(checkUrl("https://cdn.pixabay.com/a.jpg").hostname, "cdn.pixabay.com");
});

test("safeFetch: an allowed name that resolves to a private address is refused before connecting", async () => {
  for (const address of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "192.168.1.4", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
    const lookup = publicLookup((_host, _opts, done) => done(null, [{ address, family: address.includes(":") ? 6 : 4 }]));
    await assert.rejects(
      safeFetch("https://www.youtube.com/oembed?url=x", { allowHosts: MEDIA_HOSTS.youtube.oembedHosts, lookup, timeoutMs: 2000 }),
      (error) => error instanceof FetchRefused && /not public/.test(error.message),
      address,
    );
  }
});

test("lookup: the host's own oEmbed address and picture server only, the poster stored under one name per video", async () => {
  const host = fakeHost();
  const lookup = createMediaLookup({ fetch: host.fetch, storePoster: host.storePoster });
  const found = await lookup(`https://youtu.be/${YT}?t=90`, { subject: "ada" });
  assert.equal(found.found, true);
  assert.deepEqual(found.media, {
    provider: "youtube", id: YT, url: `https://www.youtube.com/watch?v=${YT}`, start: 90,
    title: "Launch demo", author: "Slatebox",
    poster: `https://files.slatebox.test/media-posters/youtube/${YT}.jpg`, posterWidth: 480, posterHeight: 360,
  });
  assert.equal(host.calls.length, 2);
  const [oembed, picture] = host.calls;
  assert.equal(new URL(oembed.url).origin + new URL(oembed.url).pathname, "https://www.youtube.com/oembed");
  assert.equal(new URL(oembed.url).searchParams.get("url"), `https://www.youtube.com/watch?v=${YT}`, "the canonical address, never the pasted text");
  assert.deepEqual(oembed.options.allowHosts, MEDIA_HOSTS.youtube.oembedHosts);
  assert.ok(oembed.options.maxBytes <= 64 * 1024);
  assert.deepEqual(picture.options.allowHosts, MEDIA_HOSTS.youtube.posterHosts);
  assert.deepEqual(host.stored, [{ key: `media-posters/youtube/${YT}.jpg`, size: JPEG.length, contentType: "image/jpeg" }]);

  // The same video again (another start time) is answered from the cache: nothing reaches the host.
  const again = await lookup(`https://www.youtube.com/watch?v=${YT}`, { subject: "ben" });
  assert.equal(again.media.poster, found.media.poster);
  assert.equal(again.media.start, undefined);
  assert.equal(host.calls.length, 2);
});

test("lookup: a poster address the answer makes up is never fetched", async () => {
  for (const thumbnail_url of ["https://evil.example/x.jpg", "https://169.254.169.254/latest", "http://i.ytimg.com/vi/x/hq.jpg", "https://i.ytimg.com.evil.example/x.jpg", "file:///etc/passwd", "", 42]) {
    const host = fakeHost({ oembed: { thumbnail_url } });
    const lookup = createMediaLookup({ fetch: host.fetch, storePoster: host.storePoster, log: { warn() {} } });
    const found = await lookup(`https://youtu.be/${YT}`, { subject: "ada" });
    assert.equal(host.calls.length, 1, String(thumbnail_url));
    assert.equal(found.media.poster, undefined);
    assert.equal(found.media.title, "Launch demo", "the title still comes back");
    assert.match(found.notice, /picture could not be fetched/);
    assert.equal(host.stored.length, 0);
  }
});

test("lookup: bytes that are not a picture are not stored, whatever the header says", async () => {
  const host = fakeHost({ poster: Buffer.from("<svg onload=alert(1)></svg>   ") });
  const lookup = createMediaLookup({ fetch: host.fetch, storePoster: host.storePoster, log: { warn() {} } });
  const found = await lookup(`https://youtu.be/${YT}`, { subject: "ada" });
  assert.equal(found.media.poster, undefined);
  assert.equal(host.stored.length, 0);
  assert.equal(sniffImage(JPEG), "image/jpeg");
  // A picture server that labels a JPEG application/octet-stream (Loom's) is read by its bytes.
  const loom = fakeHost();
  const seen = [];
  const labelled = async (url, options) => { seen.push(options.contentTypes); return loom.fetch(url, options); };
  const fromLoom = createMediaLookup({ fetch: labelled, storePoster: loom.storePoster });
  await fromLoom(`https://youtu.be/${YT}`, { subject: "ada" });
  assert.ok(seen[1].includes("application/octet-stream"));
  assert.equal(loom.stored[0].contentType, "image/jpeg");
  assert.equal(sniffImage(Buffer.from("GIF89a......")), "image/gif");
});

test("lookup: any address that is not a YouTube, Vimeo or Loom video is refused before any fetch", async () => {
  const host = fakeHost();
  const lookup = createMediaLookup({ fetch: host.fetch, storePoster: host.storePoster });
  for (const url of ["https://example.com/v.mp4", "http://10.0.0.5/watch?v=" + YT, "https://user:pw@youtu.be/" + YT, "https://youtu.be:8443/" + YT, "javascript:alert(1)", "https://youtube.com/watch?v=short"]) {
    await assert.rejects(lookup(url), (error) => error.code === "not_a_video" && error.status === 400, url);
  }
  assert.equal(host.calls.length, 0);
});

test("lookup: a host that shares nothing still gives a playable video, with a notice", async () => {
  const host = fakeHost({ failOembed: true });
  const lookup = createMediaLookup({ fetch: host.fetch, storePoster: host.storePoster, log: { warn() {} } });
  const found = await lookup("https://vimeo.com/76979871/abc123def", { subject: "ada" });
  assert.equal(found.found, false);
  assert.deepEqual(found.media, { provider: "vimeo", id: "76979871", url: "https://vimeo.com/76979871/abc123def", hash: "abc123def" });
  assert.match(found.notice, /Vimeo did not share/);
  assert.equal(new URL(host.calls[0].url).hostname, "vimeo.com");
  assert.equal(posterKey(found.media, "image/webp"), "media-posters/vimeo/76979871-abc123def.webp");
});

test("lookup: a preview looks up the title and stores no poster", async () => {
  const host = fakeHost();
  const lookup = createMediaLookup({ fetch: host.fetch, storePoster: host.storePoster });
  const found = await lookup("https://www.loom.com/share/my-demo-0123456789abcdef0123456789abcdef", { subject: "ada", store: false });
  assert.equal(found.media.title, "Launch demo");
  assert.equal(found.media.poster, undefined);
  assert.equal(host.stored.length, 0);
  assert.equal(new URL(host.calls[0].url).origin, "https://www.loom.com");
});

test("lookup: at most 60 new videos per person per hour; cached ones are free", async () => {
  let t = 0;
  const limit = createHourlyLimit({ perHour: 3, now: () => t });
  const host = fakeHost();
  const lookup = createMediaLookup({ fetch: host.fetch, storePoster: host.storePoster, limit });
  const ids = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"];
  for (const id of ids.slice(0, 3)) await lookup(`https://youtu.be/${id}`, { subject: "ada" });
  await lookup(`https://youtu.be/${ids[0]}`, { subject: "ada" });
  await assert.rejects(lookup(`https://youtu.be/${ids[3]}`, { subject: "ada" }), (error) => error.code === "rate_limited" && error.status === 429);
  await lookup(`https://youtu.be/${ids[3]}`, { subject: "ben" });
  t += 61 * 60 * 1000;
  await lookup(`https://youtu.be/dddddddddd1`, { subject: "ada" });
  assert.equal(createHourlyLimit().take("x"), true);
});

test("one action each, on every surface: Meteor method, /api/v1 route, exec method and MCP tool", async () => {
  const { createAppRegistry } = await import("../web/app/server/actions/index.mjs");
  const { buildClientManifest, renderExecTool } = await import("../web/app/server/actions/client-render.mjs");
  const registry = createAppRegistry();
  const lookup = registry.get("media.lookup");
  const add = registry.get("slates.addMedia");
  assert.deepEqual(lookup.mounts.http, { method: "POST", path: "/media/lookup", operationId: "lookupMedia" });
  assert.equal(lookup.mounts.ddp, true);
  assert.equal(lookup.tool.name, "lookup_media");
  assert.equal(lookup.changesNoSlate, true);
  assert.equal(lookup.openWorld, true);
  assert.deepEqual(add.mounts.http, { method: "POST", path: "/slates/{shareId}/media", operationId: "addMediaNote" });
  assert.equal(add.mounts.ddp, true);
  assert.equal(add.tool.name, "add_media_note");
  assert.equal(add.scope, "slates:write");
  assert.deepEqual(add.modes, ["save", "preview"]);
  const manifest = buildClientManifest(registry);
  const typed = renderExecTool(manifest).typed.map((tool) => tool.method);
  assert.ok(typed.includes("media.lookup") && typed.includes("slates.addMedia"));
  const generated = readFileSync(new URL("../web/app/server/actions/generated/slatebox.d.ts", import.meta.url), "utf8");
  assert.match(generated, /function addMedia\(/);
  assert.equal(readFileSync(new URL("../packages/slatebox-mcp/generated/slatebox.d.ts", import.meta.url), "utf8"), generated, "the published MCP server carries the same client");
});

test("agents and exec: add a video in one save, preview saves nothing, a reader is refused", async (t) => {
  const world = makeExecWorld();
  t.after(() => world.close());
  const host = fakeHost();
  world.deps.media = createMediaLookup({ fetch: host.fetch, storePoster: host.storePoster });
  const principal = await world.principalFor(["slates:read", "slates:write"]);

  const before = world.slate("demo").nodes.length;
  const preview = await world.registry.run(principal, "slates.addMedia", { shareId: "demo", url: `https://youtu.be/${YT}`, x: 100, y: 600, mode: "preview" });
  assert.equal((preview.body ?? preview).mode, "preview");
  assert.equal(world.slate("demo").nodes.length, before);
  assert.equal(host.stored.length, 0, "a preview stores no poster");

  const saved = await world.registry.run(principal, "slates.addMedia", { shareId: "demo", url: `https://youtu.be/${YT}`, x: 100, y: 600 });
  const body = saved.body ?? saved;
  assert.equal(body.ok, true);
  assert.equal(body.message, 'Added "Launch demo".');
  const node = world.slate("demo").nodes.find((n) => n.options.id === body.nodeId);
  assert.ok(node, "the note is saved");
  assert.equal(node.options.media.provider, "youtube");
  assert.equal(node.options.media.title, "Launch demo");
  assert.equal(node.options.image, `https://files.slatebox.test/media-posters/youtube/${YT}.jpg`, "the poster is the note's picture");
  assert.equal(node.options.imageFit, "cover");
  assert.deepEqual([node.options.xPos, node.options.yPos, node.options.width, node.options.height], [100, 600, 320, 180]);

  // The same from an exec script, through the generated client.
  const out = await world.exec.service.run({ principal, intent: "Add a video", code: `return slatebox.slates.addMedia({ shareId: "demo", url: "https://vimeo.com/76979871" })` });
  assert.equal(out.status, "completed", JSON.stringify(out));
  assert.equal(out.calls[0].status, 201, "an additive edit of the caller's slate is not held");
  const vimeo = world.slate("demo").nodes.find((n) => n.options.media?.provider === "vimeo");
  assert.ok(vimeo, "the script's video note is saved");
  // The fake answer named a YouTube picture server for a Vimeo video: not Vimeo's, so never fetched.
  assert.equal(vimeo.options.image, undefined);

  const reader = await world.principalFor(["slates:read"]);
  await assert.rejects(world.registry.run(reader, "slates.addMedia", { shareId: "demo", url: `https://youtu.be/${YT}` }), (error) => error.status === 403);
  // Who may write a slate is decided as for slates.applyOperations (loadSlate(true), then the same
  // canvas save): whatever that allows or refuses, this does too.
  const plan = { message: "x", operations: [{ kind: "add_nodes", count: 1, shape: "rectangle", text: "x" }] };
  for (const shareId of ["theirs", "nowhere"]) {
    const edit = await world.registry.run(principal, "slates.applyOperations", { shareId, expectedRevision: 0, plan }).then((r) => r.status, (e) => e.status);
    const video = await world.registry.run(principal, "slates.addMedia", { shareId, url: `https://youtu.be/${YT}` }).then((r) => r.status, (e) => e.status);
    assert.equal(video, edit, shareId);
  }
  await assert.rejects(world.registry.run(principal, "slates.addMedia", { shareId: "demo", url: "https://example.com/clip.mp4" }), { code: "not_a_video" });
  await assert.rejects(world.registry.run(principal, "slates.addMedia", { shareId: "demo", url: `https://youtu.be/${YT}`, x: 4 }), { code: "invalid_request" });
});

test("the canvas hands a pasted video address to the server lookup; still pictures never play", () => {
  const read = (path) => readFileSync(new URL(`../web/app/${path}`, import.meta.url), "utf8");
  const canvas = read("imports/ui/pages/Canvas.jsx");
  assert.match(canvas, /onMediaRequested: \(request\) => \{/);
  assert.match(canvas, /Meteor\.callAsync\('media\.lookup', input\)/);
  const add = read("imports/api/client/addMediaNote.js");
  assert.match(add, /kind: 'add_nodes'/);
  assert.match(add, /executeSlateOperations\(/);
  for (const path of ["imports/ui/components/SnapSlate.jsx", "imports/ui/components/slate/SlateSnapshots.jsx", "imports/ui/pages/SlateTemplates.jsx", "imports/ui/components/BrandPreviewSlate.jsx"]) {
    assert.match(read(path), /mediaPlayback: false/, path);
  }
  // The presenter's stage plays videos inline.
  assert.doesNotMatch(read("imports/ui/components/presentations/livePresenter.mjs"), /mediaPlayback: false/);
});

test("a video note's poster must be one Slatebox stored: another host's picture or another app path is refused in a plan", async (t) => {
  const allowed = posterAllowedFor({ aws: { cloudUrl: "https://files.slatebox.test" }, public: { baseUrl: "https://app.slatebox.test" } });
  assert.equal(allowed(`https://files.slatebox.test/media-posters/youtube/${YT}.jpg`), true);
  assert.equal(allowed("/sbimages/media-posters%2Fyoutube%2Fabc.jpg"), true);
  assert.equal(allowed("https://app.slatebox.test/sbimages/media-posters%2Fvimeo%2F1.jpg"), true);
  for (const bad of ["https://evil.example/pixel.gif", "https://files.slatebox.test/other/x.jpg", "/api/v1/slates", "/sbimages/media-posters/../../logout", "https://files.slatebox.test.evil.example/media-posters/x.jpg", "http://files.slatebox.test/media-posters/x.jpg"])
    assert.equal(allowed(bad), false, bad);
  // a self-host with no https address: only the app's own /sbimages/ copy
  assert.equal(posterAllowedFor({})("https://anything.example/media-posters/x.jpg"), false);

  const world = makeExecWorld();
  t.after(() => world.close());
  const host = fakeHost();
  world.deps.media = createMediaLookup({ fetch: host.fetch, storePoster: host.storePoster });
  world.deps.posterAllowed = allowed;
  const principal = await world.principalFor(["slates:read", "slates:write"]);
  // a looked-up video still adds, with its stored poster
  const saved = await world.registry.run(principal, "slates.addMedia", { shareId: "demo", url: `https://youtu.be/${YT}` });
  assert.equal((saved.body ?? saved).ok, true);
  const edit = (poster) => world.registry.run(principal, "slates.applyOperations", { shareId: "demo", expectedRevision: world.slate("demo").revision ?? 0,
    plan: { message: "v", operations: [{ kind: "add_nodes", count: 1, media: { url: `https://youtu.be/${YT}`, poster } }] } });
  await assert.rejects(edit("https://evil.example/pixel.gif"), (error) => error.code === "invalid_operation_plan" && /picture Slatebox stored/.test(error.message));
  await assert.rejects(edit("/logout"), { code: "invalid_operation_plan" });
  assert.equal((await edit(`https://files.slatebox.test/media-posters/youtube/${YT}.jpg`)).status, 201);
});

test("pasted video notes land on free space near the middle of the view, never on each other or on notes", async () => {
  const { freeSpotNear } = await import("../web/app/imports/api/common/free-spot.mjs");
  const size = { width: 320, height: 180 };
  const taken = [{ x: 0, y: 0, width: 200, height: 90 }];
  const placed = [];
  for (let i = 0; i < 3; i++) {
    const spot = freeSpotNear({ x: 100, y: 45 }, size, [...taken, ...placed]);
    for (const other of [...taken, ...placed]) {
      const apart = spot.x >= other.x + other.width || spot.x + size.width <= other.x || spot.y >= other.y + other.height || spot.y + size.height <= other.y;
      assert.ok(apart, JSON.stringify({ spot, other }));
    }
    placed.push(spot);
  }
  // free already: exactly where asked
  assert.deepEqual(freeSpotNear({ x: 1000, y: 1000 }, size, taken), { x: 840, y: 910, width: 320, height: 180 });
});
