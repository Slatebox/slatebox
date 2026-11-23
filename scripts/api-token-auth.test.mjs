import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  createApiTokenService,
  extractBearerToken,
  hashApiToken,
} from "../web/app/server/api-token-core.mjs";

let tokenDocs;
let userDocs;
let slateDoc;
let accessDoc;
let service;

beforeEach(() => {
  tokenDocs = [];
  slateDoc = {
    _id: "slate-1",
    shareId: "demo",
    userId: "owner",
    options: { isPublic: false },
  };
  accessDoc = null;
  userDocs = [{ _id: "owner" }, { _id: "visitor", isAnonymous: true }];
  service = createApiTokenService({
    users: {
      async findOneAsync({ _id }) {
        return userDocs.find((doc) => doc._id === _id);
      },
    },
    apiTokens: {
      async insertAsync(doc) {
        const id = "token-" + (tokenDocs.length + 1);
        tokenDocs.push({ _id: id, ...doc });
        return id;
      },
      async findOneAsync(selector) {
        return tokenDocs.find(
          (doc) =>
            doc.tokenHash === selector.tokenHash &&
            doc.revokedAt === selector.revokedAt,
        );
      },
      async updateAsync(selector, modifier) {
        const doc = tokenDocs.find((item) => item._id === selector._id);
        if (doc) Object.assign(doc, modifier.$set);
      },
    },
    slates: {
      async findOneAsync({ shareId }) {
        return slateDoc?.shareId === shareId ? slateDoc : null;
      },
    },
    slateAccess: {
      find({ slateId, type }) {
        return { fetchAsync: async () => [accessDoc].filter(row => row?.slateId === slateId && row.type === type) };
      },
    },
    now: () => 12345,
    randomBytesImpl: (size) => Buffer.alloc(size, size + tokenDocs.length),
  });
});

test("bearer extraction is strict and token hashes are deterministic", () => {
  assert.equal(
    extractBearerToken({
      headers: { authorization: "Bearer sbx_test_secret" },
    }),
    "sbx_test_secret",
  );
  assert.equal(
    extractBearerToken({ headers: { authorization: "Basic abc" } }),
    null,
  );
  assert.equal(hashApiToken("same"), hashApiToken("same"));
  assert.notEqual(hashApiToken("same"), hashApiToken("different"));
});

test("token creation returns the secret once and stores only its hash", async () => {
  const created = await service.createApiToken({
    userId: "owner",
    name: "  Codex workspace  ",
    scopes: ["slates:read", "slates:write", "slates:read"],
  });
  assert.match(created.token, /^sbx_[a-f0-9]{8}_/);
  assert.equal(created.name, "Codex workspace");
  assert.deepEqual(created.scopes, ["slates:read", "slates:write"]);
  assert.equal(created.tokenHash, undefined);
  assert.equal(tokenDocs[0].token, undefined);
  assert.equal(tokenDocs[0].tokenHash, hashApiToken(created.token));
});

// Restated (P02): scopes are checked by the action registry, which answers 403
// insufficient_scope (scripts/action-registry.test.mjs). Authentication resolves the token
// and its account, and carries the token's scopes to that check.
test("authentication enforces prefix and revocation, and carries the token's scopes", async () => {
  const created = await service.createApiToken({
    userId: "owner",
    name: "CLI",
    scopes: ["slates:read"],
  });
  const req = {
    get: () => `Bearer ${created.token}`,
  };
  const authenticated = await service.authenticateApiRequest(req);
  assert.equal(authenticated.token._id, "token-1");
  assert.deepEqual(authenticated.token.scopes, ["slates:read"]);
  assert.equal(authenticated.account._id, "owner");
  assert.equal(tokenDocs[0].lastUsedAt, 12345);

  tokenDocs[0].revokedAt = 12345;
  assert.equal(await service.authenticateApiRequest(req), null);
  assert.equal(
    await service.authenticateApiRequest({ get: () => "Bearer not-a-slatebox-token" }),
    null,
  );
});

test("invitation management requires its own explicitly issued permission", async () => {
  const editor = await service.createApiToken({ userId: "owner", name: "Editor", scopes: ["slates:read", "slates:write"] });
  const share = await service.createApiToken({ userId: "owner", name: "Sharing", scopes: ["slates:share"] });
  const request = issued => ({ headers: { authorization: "Bearer " + issued.token } });
  assert.equal((await service.authenticateApiRequest(request(editor))).token.scopes.includes("slates:share"), false);
  assert.deepEqual((await service.authenticateApiRequest(request(share))).token.scopes, ["slates:share"]);
});

test("a token whose account is gone, or is not a registered account, does not authenticate", async () => {
  const created = await service.createApiToken({ userId: "owner", name: "Orphan", scopes: ["slates:read"] });
  const req = { get: () => `Bearer ${created.token}` };
  assert.ok(await service.authenticateApiRequest(req));
  tokenDocs[0].lastUsedAt = null;
  userDocs = userDocs.filter((doc) => doc._id !== "owner");
  assert.equal(await service.authenticateApiRequest(req), null);
  assert.equal(tokenDocs[0].lastUsedAt, null, "a refused token is not marked used");
  const visitor = await service.createApiToken({ userId: "visitor", name: "Guest", scopes: ["slates:read"] });
  assert.equal(await service.authenticateApiRequest({ get: () => `Bearer ${visitor.token}` }), null);
});

test("slate authorization follows owner, public, and collaborator permissions", async () => {
  const owner = { userId: "owner" };
  const collaborator = { userId: "collaborator" };
  assert.equal(
    (await service.authorizeTokenForSlate(owner, "demo", true)).authorized,
    true,
  );

  slateDoc.options.isPublic = true;
  assert.equal(
    (await service.authorizeTokenForSlate(collaborator, "demo", true))
      .authorized,
    true,
  );

  slateDoc.options.isPublic = false;
  accessDoc = {
    slateId: "slate-1",
    userId: "collaborator",
    type: "private",
    slateAccessPermissionId: "READ",
  };
  assert.equal(
    (await service.authorizeTokenForSlate(collaborator, "demo")).authorized,
    true,
  );
  assert.equal(
    (await service.authorizeTokenForSlate(collaborator, "demo", true))
      .authorized,
    false,
  );
  accessDoc.slateAccessPermissionId = "EDIT";
  assert.equal(
    (await service.authorizeTokenForSlate(collaborator, "demo", true))
      .authorized,
    true,
  );
  assert.equal(
    (await service.authorizeTokenForSlate(owner, "missing", true)).authorized,
    false,
  );
});

test("active named roles constrain public API writes; archived grants cannot authorize private work", async () => {
  const token = { userId: "teammate" };
  const allowed = async write => (await service.authorizeTokenForSlate(token, "demo", write)).authorized;
  slateDoc.options.isPublic = true;
  accessDoc = { slateId: slateDoc._id, userId: token.userId, type: "public", slateAccessPermissionId: "READ" };
  assert.equal(await allowed(false), true);
  assert.equal(await allowed(true), false);
  accessDoc.slateAccessPermissionId = "NONE";
  assert.equal(await allowed(false), false);
  accessDoc.slateAccessPermissionId = "EDIT";
  slateDoc.options.isPublic = false;
  assert.equal(await allowed(true), false);
  slateDoc.creative = {model:{kind:"workshop"}};
  slateDoc.options.isPublic = true;
  assert.equal(await allowed(true), true);
  accessDoc = null;
  assert.equal(await allowed(true), false);
  assert.equal(await allowed(false), true);
});
