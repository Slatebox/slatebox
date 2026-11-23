// describe: how an agent learns the generated `slatebox` client before writing an exec script.
// A port of describeClient in the app's web/app/server/actions/client-render.mjs, so the local
// and hosted describe tools answer alike (test/describe-parity.test.js holds them equal).
// Everything comes from generated/client.json.

export const DESCRIBE_BUDGET = 40000;

export class DescribeInputError extends Error {
  constructor(message) { super(message); this.code = "invalid_request"; this.status = 400; }
}

// The describe tool's inputSchema, checked here because this server serves raw JSON schemas.
function checkInput(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new DescribeInputError("describe takes an object.");
  const extra = Object.keys(input).filter((key) => key !== "query" && key !== "methods");
  if (extra.length) throw new DescribeInputError(`describe takes query and methods only, not ${extra.join(", ")}.`);
  if (input.query !== undefined && (typeof input.query !== "string" || input.query.length > 200)) throw new DescribeInputError("query is text of at most 200 characters.");
  if (input.methods !== undefined && (!Array.isArray(input.methods) || input.methods.length > 12 || input.methods.some((n) => typeof n !== "string" || n.length > 80)))
    throw new DescribeInputError("methods is a list of at most 12 method names.");
}

export function describeClient(manifest, input = {}, { instance } = {}) {
  const { query, methods: names } = input || {};
  let chosen = manifest.methods;
  let detailed = false;
  if (Array.isArray(names) && names.length) {
    const wanted = new Set(names);
    chosen = manifest.methods.filter((method) => wanted.has(method.name));
    detailed = true;
  } else if (typeof query === "string" && query.trim()) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    chosen = manifest.methods
      .filter((method) => {
        const hay = `${method.name} ${method.title} ${method.summary}`.toLowerCase();
        return words.some((word) => hay.includes(word));
      })
      .slice(0, 12);
    detailed = true;
  }
  const typeNames = new Set(detailed ? chosen.flatMap((method) => method.types) : []);
  const out = {
    contract: manifest.contract,
    rules: manifest.rules,
    methods: chosen.map((method) => ({
      name: method.name,
      title: method.title,
      summary: method.summary,
      kind: method.kind,
      flags: [
        method.readOnly ? "read" : "write",
        method.destructive && "destructive",
        method.openWorld && "openWorld",
        method.confirm && "confirm",
      ].filter(Boolean),
      scope: method.scope,
      modes: method.modes,
      ...(detailed ? { dts: method.dts } : { index: method.index }),
    })),
    types: [manifest.errorDeclaration, ...[...typeNames].sort().map((name) => manifest.types[name])].join("\n\n"),
    errors: manifest.errors,
    limits: manifest.limits,
    ...(!detailed && { recipes: manifest.recipes }),
    ...(instance && { instance }),
  };
  const text = JSON.stringify(out);
  if (text.length > DESCRIBE_BUDGET) {
    out.types = out.types.slice(0, Math.max(0, out.types.length - (text.length - DESCRIBE_BUDGET) - 200));
    out.truncated = true;
  }
  return out;
}

/**
 * The describe tool. instance: an async function returning the instance descriptor once the
 * client binds instance.describe (wave 2, P08); until then the field is left out.
 */
export async function describe(input = {}, { generated, instance } = {}) {
  checkInput(input ?? {});
  let descriptor;
  if (instance && generated.methods.has("instance.describe")) {
    try { descriptor = await instance(); } catch { /* optional: describe still answers */ }
  }
  return describeClient(generated.manifest, input, { instance: descriptor });
}
