// What a first visit downloads: the modules reachable from the browser's entry (client/main.jsx) by static
// imports. Heavy tools a first visit never opens load with import() when first used (perf/client-bundle),
// and this keeps them there: the JSON editor of the AI conversation editor, the template editor's Markdown
// editor, the uploader, and the pages a slate's first paint never shows. scripts/check-client-bundle.mjs
// measures the built bundle; this says why it stays small.
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "../web/app");
const extensions = ["", ".js", ".jsx", ".mjs", ".ts", ".tsx", "/index.js", "/index.jsx"];
const file = (base) => extensions.map((ext) => base + ext).find((path) => existsSync(path) && statSync(path).isFile());

/** Every module statically reachable from `entry`: the app's own files, and the packages they name. */
function reachable(entry) {
  const files = new Set();
  const packages = new Set();
  const queue = [entry];
  while (queue.length) {
    const at = queue.pop();
    if (files.has(at)) continue;
    files.add(at);
    const source = readFileSync(at, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // Static imports and re-exports only: import('…') is what loads later.
    for (const [, spec] of source.matchAll(/^\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) {
      if (spec.startsWith(".")) {
        const found = file(join(dirname(at), spec));
        if (found && /\.(m?js|jsx|tsx?)$/.test(found)) queue.push(found);
      } else if (!spec.startsWith("meteor/") && !spec.startsWith("/")) {
        packages.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
      }
    }
  }
  return { files, packages };
}

const { files, packages } = reachable(join(app, "client/main.jsx"));
const own = (path) => files.has(join(app, path));

test("the first load reaches the canvas, the start page and My Slates", () => {
  assert.ok(own("imports/ui/pages/Canvas.jsx"));
  assert.ok(own("imports/ui/pages/MySlates.jsx") || own("imports/ui/pages/MySlates.js"));
  assert.ok(own("imports/ui/pages/GetStarted.jsx"));
  assert.ok(packages.has("slateboxjs"));
});

test("heavy tools a first visit never opens are not in the first load", () => {
  for (const heavy of ["vanilla-jsoneditor", "react-markdown-editor-lite", "markdown-it", "dropzone"]) {
    assert.ok(!packages.has(heavy), `${heavy} is reached by a static import from client/main.jsx`);
  }
});

test("pages a slate's first paint never shows load when their route is first opened", () => {
  for (const page of ["imports/ui/pages/SlateTemplates.jsx", "imports/ui/pages/Present.jsx", "imports/ui/pages/OAuthConsent.jsx",
    "imports/ui/pages/DecisionWorkshopPage.jsx", "imports/ui/pages/AdminTools.jsx", "imports/ui/pages/BrandingSettings.jsx",
    "imports/ui/pages/TeamSettings.jsx", "imports/ui/pages/Profile.jsx", "imports/ui/pages/Team.jsx", "imports/ui/pages/ShowThemes.jsx",
    "imports/ui/components/ai/CreatePersona.jsx", "imports/ui/components/TemplateDetails.jsx"]) {
    assert.ok(existsSync(join(app, page)), page + " exists");
    assert.ok(!own(page), page + " is in the first load");
  }
});
