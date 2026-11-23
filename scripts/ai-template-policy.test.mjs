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

test("the template gallery is gone: creation links open a new slate, and no /templates route or link remains", async () => {
  // Superseded (2026-11-23): the public template gallery and its creation-link redirects were
  // replaced by the shared library (/library). The policy keeps only the welcome assistant's rule.
  const policy = await import("../web/app/imports/api/common/template-policy.mjs");
  assert.deepEqual(Object.keys(policy).sort(), ["isUserSelectableTemplate", "userSelectableTemplateSelector"]);
  const main = await readFile(new URL("../web/app/client/main.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(main, /\/templates|SlateTemplates|legacyTemplateDestination/);
});
