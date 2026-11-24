import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isUserSelectableTemplate,
  userSelectableTemplateSelector,
} from "../web/app/imports/api/common/template-policy.mjs";

test("template discovery takes approved templates only", () => {
  assert.deepEqual(userSelectableTemplateSelector(), {
    "options.isTemplate": true,
    "options.templateApproved": true,
  });
});

test("template lookup preserves identity constraints alongside eligibility", () => {
  assert.deepEqual(userSelectableTemplateSelector({ shareId: "template-1" }), {
    shareId: "template-1",
    "options.isTemplate": true,
    "options.templateApproved": true,
  });
});

test("only approved templates are user-selectable", () => {
  assert.equal(
    isUserSelectableTemplate({
      options: { isTemplate: true, templateApproved: true },
    }),
    true,
  );
  assert.equal(
    isUserSelectableTemplate({
      options: { isTemplate: true, templateApproved: false },
    }),
    false,
  );
});

test("welcome discovery and template validation share the eligibility policy", async () => {
  const source = await readFile(
    new URL("../web/app/server/methods/openai.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /Slates\.find\(\s*userSelectableTemplateSelector\(\)/);
  assert.match(
    source,
    /Slates\.findOneAsync\(\s*userSelectableTemplateSelector\(\{ shareId: slateTemplateId \}\)/,
  );
});

test("explicit creation links preserve known aliases, names, IDs and copy titles", async () => {
  const { legacyTemplateDestination, templateCopyTopic } = await import("../web/app/imports/api/common/template-policy.mjs");
  assert.equal(legacyTemplateDestination("?topic=one"), null);
  for (const param of ["template", "templateId"]) {
    const search = new URLSearchParams({ [param]: "proConScaffold", topic: "R&D / next?", token: "unused" });
    const dest = new URL(legacyTemplateDestination(search), "https://app.slatebox.com");
    assert.equal(dest.pathname, "/templates/pro-con-analysis");
    assert.equal(templateCopyTopic(dest.searchParams), "R&D / next?");
    assert.deepEqual([...dest.searchParams.keys()], ["topic"]);
  }
  assert.equal(legacyTemplateDestination("?template=Pro%2FCon+Analysis"), "/templates/pro-con-analysis");
  assert.equal(legacyTemplateDestination("?templateId=tplprocon001"), "/templates/tplprocon001");
  assert.equal(legacyTemplateDestination("?templateId=Case_Sensitive-ID"), "/templates/Case_Sensitive-ID");
  assert.equal(legacyTemplateDestination("?template=removed-template"), "/templates/removed-template");
  assert.equal(legacyTemplateDestination("?template=%2E%2E%2F"), "/templates");
  assert.equal(legacyTemplateDestination("?template=" + "x".repeat(241)), "/templates");
  assert.equal(templateCopyTopic(new URLSearchParams({ topic: " a".repeat(200) })).length, 160);
});
