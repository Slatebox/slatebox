// Generated from the Slatebox action registry (contract 1.0). Do not edit.

// The global `slatebox` inside an exec script. Every method takes one object.

declare namespace slatebox.account {
  /** Account. Your name, address and whether it is verified, team and claims, AI drafting access, what is included this month (ai.included, null on a server with no meter) and whether you have Slatebox Pro (ai.pro, null without it), the token you called with, and the addresses where you change what a token may not (profile, and Credits for Slatebox Pro and top-ups). Getting Pro or topping up is done by a person in the profile, never through a token: give them links.pay (Get Pro, or Your Pro once they have it) or links.topUp, which open the payment in the app. Education is null on a self-hosted instance. */
  function get(input: Record<string, unknown>): Promise<{
    id: string;
    name: string;
    email?: string | null;
    emailVerified?: boolean;
    team?: Record<string, unknown> | null;
    education?: "none" | "requested" | "certified" | null;
    ai: Record<string, unknown>;
    token?: Record<string, unknown> | null;
    links: Record<string, unknown>;
    [key: string]: unknown;
  }>;
}

declare namespace slatebox.ai {
  /** Test AI. Tests a saved connection (name) or one not yet saved (connection): whether Slatebox can reach it, whether it accepts the key, which models it lists where it lists them, whether the model answers and whether it calls tools (which conversation, drafts and presentations need). Saves nothing. A saved key is only sent to the address it was saved for. A token needs ai:admin as well for level team or server. On a self-hosted server a model on the host is at host.docker.internal, not localhost. @scope ai:settings @openWorld @idempotent */
  function check(input: {
    /** me (yours), team (team admins) or server (administrators). */
    level?: "me" | "team" | "server";
    name?: string;
    connection?: {
      /** Your name for it, for example desk-model. */
      name: string;
      /** openai-compatible covers any host or local server (Ollama, llama.cpp, vLLM, LM Studio and others). */
      type: "openai-compatible" | "openai" | "anthropic" | "deepinfra";
      /** For openai-compatible: the address up to /v1, for example http://host.docker.internal:11434/v1. (at most 500 characters) */
      baseUrl?: string;
      /** The model name the endpoint serves. (at most 200 characters) */
      model?: string;
      /** Stored encrypted and never shown again. Leave it out to keep the saved key; send an empty string to remove it. (at most 400 characters) */
      apiKey?: string;
      /** What the model can do, where you know it. Unset means try it; making images needs images: true. */
      capabilities?: {
        tools?: boolean;
        vision?: boolean;
        images?: boolean;
      };
      /** (256 to 200000) */
      maxTokens?: number;
      /** How the endpoint takes a forced tool call: named (the function by name), required (any tool, for an endpoint with no named form) or auto (the model decides, for an endpoint that refuses the others). */
      toolChoice?: "auto" | "named" | "required";
    };
  }): Promise<({
    ok: boolean;
    reachable: boolean;
    models?: string[] | null;
    modelListed?: boolean | null;
    chat?: "ok" | "failed";
    tools: "yes" | "no" | "unknown";
    message: string;
    [key: string]: unknown;
  }) & { mode: "save" }>;
}

declare namespace slatebox.ai {
  /** AI settings. The AI connections you, your team and this server have (never their keys), which one each feature uses (chat, generation, presentation, vision, images, shape, and the default), and which connection serves each feature for you now (effective), with what it cannot do. ownProviders false means this server uses only the AI its operator set up. @scope ai:settings */
  function get(input: Record<string, unknown>): Promise<{
    features: Array<Record<string, unknown>>;
    useKeys?: string[];
    ownProviders: boolean;
    keysAvailable?: boolean;
    hosted?: boolean;
    mine?: Record<string, unknown> | null;
    team?: Record<string, unknown> | null;
    server: Record<string, unknown>;
    effective: Record<string, unknown>;
    [key: string]: unknown;
  }>;
}

declare namespace slatebox.ai {
  /** Set AI. Adds or changes AI connections (a cloud provider with its key, or any OpenAI-compatible endpoint with its address, optional key and model), removes some, and chooses which connection each feature uses. level me changes yours, team your team's (team admins), server this server's (administrators; ownProviders on or off lets people use their own). Mix freely: a choice names me:<name>, team:<name>, server:<name> or builtin. Keys are stored encrypted and never returned, and a run's record keeps its code with the apiKey replaced; still, send a key through this route, the CLI or the update_ai_settings tool rather than building it inside an exec script. Returns the settings as ai.get does. A token needs ai:admin as well for level team or server. Own AI (levels me and team) is for self-hosted Slatebox: Slatebox Cloud refuses it, as AI there comes with Slatebox Pro credits and top-ups. @scope ai:settings @destructive @confirm @idempotent */
  function update(input: {
    /** me (yours), team (team admins) or server (administrators). */
    level: "me" | "team" | "server";
    /** (at most 20 items) */
    connections?: Array<{
      /** Your name for it, for example desk-model. */
      name: string;
      /** openai-compatible covers any host or local server (Ollama, llama.cpp, vLLM, LM Studio and others). */
      type: "openai-compatible" | "openai" | "anthropic" | "deepinfra";
      /** For openai-compatible: the address up to /v1, for example http://host.docker.internal:11434/v1. (at most 500 characters) */
      baseUrl?: string;
      /** The model name the endpoint serves. (at most 200 characters) */
      model?: string;
      /** Stored encrypted and never shown again. Leave it out to keep the saved key; send an empty string to remove it. (at most 400 characters) */
      apiKey?: string;
      /** What the model can do, where you know it. Unset means try it; making images needs images: true. */
      capabilities?: {
        tools?: boolean;
        vision?: boolean;
        images?: boolean;
      };
      /** (256 to 200000) */
      maxTokens?: number;
      /** How the endpoint takes a forced tool call: named (the function by name), required (any tool, for an endpoint with no named form) or auto (the model decides, for an endpoint that refuses the others). */
      toolChoice?: "auto" | "named" | "required";
    }>;
    /** (at most 20 items) */
    remove?: string[];
    /** Which connection each feature uses. default serves every feature not named. */
    use?: {
      /** me:<name>, team:<name> or server:<name> for a connection, builtin for the AI this server provides, null to clear. (at most 48 characters) */
      default?: string | null;
      /** me:<name>, team:<name> or server:<name> for a connection, builtin for the AI this server provides, null to clear. (at most 48 characters) */
      chat?: string | null;
      /** me:<name>, team:<name> or server:<name> for a connection, builtin for the AI this server provides, null to clear. (at most 48 characters) */
      generation?: string | null;
      /** me:<name>, team:<name> or server:<name> for a connection, builtin for the AI this server provides, null to clear. (at most 48 characters) */
      presentation?: string | null;
      /** me:<name>, team:<name> or server:<name> for a connection, builtin for the AI this server provides, null to clear. (at most 48 characters) */
      vision?: string | null;
      /** me:<name>, team:<name> or server:<name> for a connection, builtin for the AI this server provides, null to clear. (at most 48 characters) */
      images?: string | null;
      /** me:<name>, team:<name> or server:<name> for a connection, builtin for the AI this server provides, null to clear. (at most 48 characters) */
      shape?: string | null;
    };
    ownProviders?: "on" | "off";
  }): Promise<({
    features: Array<Record<string, unknown>>;
    useKeys?: string[];
    ownProviders: boolean;
    keysAvailable?: boolean;
    hosted?: boolean;
    mine?: Record<string, unknown> | null;
    team?: Record<string, unknown> | null;
    server: Record<string, unknown>;
    effective: Record<string, unknown>;
    [key: string]: unknown;
  }) & { mode: "save" }>;
}

declare namespace slatebox.components {
  /** Library entry. One entry of the library (an id from components.list) with everything components.list gives plus the phrases that make each change (moves: the words a person says, what the board answers and the edit it makes) and the looping picture's steps. With shareId, whether it fits that slate. @scope slates:read */
  function get(input: {
    /** The library entry (components.list ids). (1–100 characters) */
    id: string;
    /** The slate ID from its address: /canvas/<shareId>. (1–80 characters) */
    shareId?: string;
  }): Promise<{
    catalogVersion: string;
    component: Record<string, unknown>;
    [key: string]: unknown;
  }>;
}

declare namespace slatebox.components {
  /** Library. Everything a person can add to a slate from the library (boards and starters): each entry with its group, one line, the message that adds it ("Add a retro"), the edits it takes (joined to the workshop_edits table), the rule kinds it can be given by chat, its limits and its looping picture. The phrases that make each change (moves) and the picture's steps come with components.get for one entry. With shareId, whether each fits that slate: a slate holds up to 8 boards, side by side. Add one to a slate with slates.applyOperations (plan operation add_component, with the slate revision), the same door as the chat's Add; it goes beside the boards already there. @scope slates:read */
  function list(input: {
    /** The slate ID from its address: /canvas/<shareId>. (1–80 characters) */
    shareId?: string;
  }): Promise<{
    catalogVersion: string;
    components: Array<Record<string, unknown>>;
    [key: string]: unknown;
  }>;
}

declare namespace slatebox.instance {
  /** Server. What this Slatebox instance is and can do. Without a token: its id, name, contract version and where to sign in. With a token: also the build, capability flags, limits, the canvas and workshop vocabularies, the routes it serves and your account. */
  function describe(input: Record<string, unknown>): Promise<{
    view: "public" | "account";
    instance: {
      id: string;
      name: string;
      origin: string;
      lineage?: string;
      [key: string]: unknown;
    };
    contract: {
      version: string;
      major: number;
      minor: number;
      [key: string]: unknown;
    };
    api: Record<string, unknown>;
    signIn: Record<string, unknown>;
    connect: Record<string, unknown>;
    link: Record<string, unknown>;
    build?: Record<string, unknown>;
    capabilities?: Record<string, unknown>;
    limits?: Record<string, unknown>;
    canvas?: Record<string, unknown>;
    workshops?: Record<string, unknown>;
    actions?: Array<Record<string, unknown>>;
    account?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
}

declare namespace slatebox.presence {
  /** Show a plan. Show the people on a slate what this run will do: 1 to 8 short steps, as a checklist beside your named pointer. The first step is under way; tick steps with presence.step. Saves move the pointer to what they change. At most 3 plans per run. A preview run shows nothing. @scope slates:write @modes save|preview */
  function plan(input: {
    /** The slate ID from its address: /canvas/<shareId>. (1–80 characters) */
    shareId: string;
    /** What the run will do, in order, in plain words: "Read the interview notes", "Draft a brief". (1–8 items) */
    steps: string[];
    /** preview returns what would change and saves nothing. (default "save") */
    mode?: "save" | "preview";
  }): Promise<({
    ok: boolean;
    mode?: "save" | "preview";
    shareId: string;
    plan: {
      steps: Array<{
        text: string;
        status: "todo" | "doing" | "done" | "skipped" | "stopped";
        [key: string]: unknown;
      }>;
      /** The step under way. (at least 0) */
      current: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }) & { mode: "save" | "preview" }>;
}

declare namespace slatebox.presence {
  /** Tick step. Mark a step of the plan set with presence.plan as doing, done or skipped. When a step is done and none is under way, the next one starts; a step under way is done when another starts or the run ends. At most 40 per run. A preview run changes nothing. @scope slates:write @modes save|preview */
  function step(input: {
    /** The slate ID from its address: /canvas/<shareId>. (1–80 characters) */
    shareId: string;
    /** The step, from 0. (0 to 7) */
    index: number;
    status: "doing" | "done" | "skipped";
    /** preview returns what would change and saves nothing. (default "save") */
    mode?: "save" | "preview";
  }): Promise<({
    ok: boolean;
    mode?: "save" | "preview";
    shareId: string;
    plan: {
      steps: Array<{
        text: string;
        status: "todo" | "doing" | "done" | "skipped" | "stopped";
        [key: string]: unknown;
      }>;
      /** The step under way. (at least 0) */
      current: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }) & { mode: "save" | "preview" }>;
}

declare namespace slatebox.presentations {
  /** Deck. Read your latest presentation of a slate: its style, and each step's layout (title, overview, dive, hero, treeBuild, trace, sweep, group, bigNumber, quote, split, compare, cover, finale), kicker and caption. The deck plays on the live canvas with Prezi-style camera moves. @scope slates:read */
  function get(input: {
    /** The slate ID from its address: /canvas/<shareId>. (1–80 characters) */
    shareId: string;
  }): Promise<{
    presentationId: string;
    version?: number;
    name?: string;
    published?: boolean;
    /** The style it plays in. */
    style: "voyage" | "stage" | "editorial" | "neon" | "sketch" | "blueprint" | "journey" | "calm" | null;
    /** Every style it can play in. */
    styles?: string[];
    steps: Array<{
      step: number;
      layout: "title" | "overview" | "dive" | "hero" | "treeBuild" | "trace" | "sweep" | "group" | "bigNumber" | "quote" | "split" | "compare" | "cover" | "finale";
      kicker?: string;
      caption: string;
      /** How many of the slate's notes the step shows. */
      notes?: number;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }>;
}

declare namespace slatebox.presentations {
  /** Restyle. Play your latest presentation of a slate in another style (voyage, stage, editorial, neon, sketch, blueprint, journey, calm), optionally with your own palette (3 to 6 colours). The same steps in the same order: no AI is asked and nothing is counted. @scope slates:write @idempotent */
  function setStyle(input: {
    /** The slate ID from its address: /canvas/<shareId>. (1–80 characters) */
    shareId: string;
    style: "voyage" | "stage" | "editorial" | "neon" | "sketch" | "blueprint" | "journey" | "calm";
    /** Your own colours: the first three lead, the background stays the style's. (3–6 items) */
    palette?: string[];
  }): Promise<({
    presentationId: string;
    version?: number;
    name?: string;
    published?: boolean;
    /** The style it plays in. */
    style: "voyage" | "stage" | "editorial" | "neon" | "sketch" | "blueprint" | "journey" | "calm" | null;
    /** Every style it can play in. */
    styles?: string[];
    steps: Array<{
      step: number;
      layout: "title" | "overview" | "dive" | "hero" | "treeBuild" | "trace" | "sweep" | "group" | "bigNumber" | "quote" | "split" | "compare" | "cover" | "finale";
      kicker?: string;
      caption: string;
      /** How many of the slate's notes the step shows. */
      notes?: number;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }) & { mode: "save" }>;
}

declare namespace slatebox.shapes {
  /** Shape notes. Give notes a shape: a built-in name (ellipse, star), "lib:<id>" or a name from shapes.list, or a candidateId from shapes.generate (saved to your library). Each note keeps its width and takes the shape's proportions. One save; mode "preview" saves nothing. @scope slates:write @modes save|preview */
  function apply(input: {
    /** The slate ID from its address: /canvas/<shareId>. (1–80 characters) */
    shareId: string;
    /** The notes. (1–200 items) */
    ids: string[];
    /** (1–120 characters) */
    shape: string;
    /** The revision you read; the current one when left out. (at least 0) */
    expectedRevision?: number;
    /** preview returns what would change and saves nothing. (default "save") */
    mode?: "save" | "preview";
  }): Promise<({
    ok: boolean;
    mode?: string;
    shareId: string;
    revision?: number;
    message: string;
    shape?: {
      name?: string;
      id?: string | null;
      [key: string]: unknown;
    };
    report?: Record<string, unknown>;
    [key: string]: unknown;
  }) & { mode: "save" | "preview" }>;
}

declare namespace slatebox.shapes {
  /** Draw shapes. Draw 1 to 4 outlines for notes from a description ("a rocket", "a speech bubble with the tail on the left"), using the AI feature shape (counted like other AI use). Each candidate is one checked SVG path; pass its candidateId (good for 30 days) to shapes.apply, or put {name, d, fillRule} as the shape in an applyOperations update_nodes or add_nodes plan. The same description again returns the same candidates at no cost unless fresh is true. At most 20 drawings per person per hour. @scope slates:write @modes save|preview @openWorld */
  function generate(input: {
    /** The shape, in plain words. (1–200 characters) */
    describe: string;
    /** (1 to 4, default 3) */
    count?: number;
    /** Draw new ones instead of returning the last ones for this description. (default false) */
    fresh?: boolean;
    /** preview returns what would change and saves nothing. (default "save") */
    mode?: "save" | "preview";
  }): Promise<({
    requestId?: string;
    candidates: Array<{
      id?: string;
      candidateId?: string;
      name?: string;
      /** The outline: one SVG path in a 0..100 box. */
      d?: string;
      fillRule?: "nonzero" | "evenodd";
      /** Width / height. */
      aspect?: number;
      /** Where a label sits, in 0..1 of the box. */
      textBox?: Record<string, unknown> | null;
      visibility?: "private" | "team";
      mine?: boolean;
      [key: string]: unknown;
    }>;
    cached?: boolean;
    [key: string]: unknown;
  }) & { mode: "save" | "preview" }>;
}

declare namespace slatebox.shapes {
  /** List shapes. The shapes in your library and your team's (newest used first): id, name, proportions, visibility, and the outline when 24 or fewer come back. Put one on notes with shapes.apply and shape "lib:<id>". @scope slates:read */
  function list(input: {
    /** Words in the shape name. (at most 60 characters) */
    q?: string;
    /** (default "all") */
    scope?: "mine" | "team" | "all";
    /** (1 to 100, default 24) */
    limit?: number;
  }): Promise<{
    shapes: Array<{
      id?: string;
      candidateId?: string;
      name?: string;
      /** The outline: one SVG path in a 0..100 box. */
      d?: string;
      fillRule?: "nonzero" | "evenodd";
      /** Width / height. */
      aspect?: number;
      /** Where a label sits, in 0..1 of the box. */
      textBox?: Record<string, unknown> | null;
      visibility?: "private" | "team";
      mine?: boolean;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }>;
}

declare namespace slatebox.slates {
  /** Edit a slate. Send mode "preview" to see the result without saving. Every edit names the revision it was made on: a canvas plan (notes and connections) sends expectedRevision, the revision slates.get returned; a workshop or map plan holds one operation with its own expectedRevision (workshop.revision), and saving it requires an Idempotency-Key. Without it the edit is refused with 400 invalid_request naming expectedRevision. On a workshop, workshop_edits makes 1 to 50 edits (add, move, rename, remove cards and lanes) by the rules people meet; a refusal answers 409 edit_refused with the sentence a person sees, and a move the rules refuse answers 409 move_refused. A saved workshop edit answers with a receiptId that undo_workshop_edit takes. A slate holds up to 8 boards: a workshop operation names its board (boardId, from slates.get boards[]); on a slate of several boards one that names none is refused with 400 board_required listing them. add_component adds a library component (components.list) beside the slate's notes and boards and answers with its boardId; it carries its own expectedRevision (the slate revision). @scope slates:write @modes save|preview @destructive */
  function applyOperations(input: {
    /** The slate ID from its address: /canvas/<shareId>. (1–80 characters) */
    shareId: string;
    /** What the person asked for, in their words. (default "") */
    userMessage?: string;
    /** Required with a canvas plan: the slate revision you read (slates.get, GET /slates/{shareId}). The edit is refused with 409 slate_changed only if a note or setting it changes was changed after that revision; adding notes never conflicts. Leaving it out is refused with 400 invalid_request. Workshop and map edits carry their own expectedRevision in the plan, and send none here. (at least 0) */
    expectedRevision?: number;
    plan: CanvasPlan | WorkshopEditsPlan | WorkshopUndoPlan | WorkshopMovePlan | PresentationOrderPlan | WorkshopLinePlan | MapAuthoringPlan | AddComponentPlan;
    /** preview returns what would change and saves nothing. (default "save") */
    mode?: "save" | "preview";
  }): Promise<({
    ok: boolean;
    mode: "save" | "preview";
    shareId: string;
    /** The slate revision after this save (for a preview, as read). (at least 0) */
    revision?: number;
    message: string;
    operations: Array<Record<string, unknown>>;
    report: {
      presentationOrder?: string[];
      /** workshop_edits: what each edit did, in the sentence a person is told. */
      edits?: Array<Record<string, unknown>>;
      movedCards?: Array<Record<string, unknown>>;
      addedCards?: string[];
      removedCards?: string[];
      removedLanes?: string[];
      removedLinks?: Array<Record<string, unknown>>;
      removedOutcomes?: string[];
      /** The notes the edit touched, as the canvas names them (card-<id>, lane-<id>). */
      targets?: string[];
      /** undo_workshop_edit: the receipt it undid. */
      undone?: string;
      addedBranches?: Array<Record<string, unknown>>;
      updatedOutcomes?: Array<Record<string, unknown>>;
      lines?: Array<Record<string, unknown>>;
      removedLines?: string[];
      [key: string]: unknown;
    };
    /** A saved workshop edit: pass it to undo_workshop_edit. */
    receiptId?: string;
    workshop?: Workshop;
    [key: string]: unknown;
  }) & { mode: "save" | "preview" }>;
}

declare namespace slatebox.slates {
  /** Check move. Whether a card may move to a lane on one of the slate's boards (boardId; required on a slate of several boards, 400 board_required lists them), without moving it: the same verdict a drag gets. On a nested board (piles, a tree) name the card it goes under instead (under), or the area it goes to (lane). Answers {ok: true, warnings} or {refused: {sentence, ruleId, nearest, set}}: the one rule that refuses it (ruleId null for the board's own kind rule), who set it, and the nearest lane (or card) it may go to. rev is the rulebook's revision. Name cards and lanes by id or by name. @scope slates:read */
  function checkMove(input: {
    /** The slate ID from its address: /canvas/<shareId>. (1–80 characters) */
    shareId: string;
    /** The board (slates.get boards[].id; main is the first). Required when the slate holds several boards. */
    boardId?: string;
    /** An id, or what a person calls it. (1–200 characters) */
    card: string;
    /** An id, or what a person calls it. (1–200 characters) */
    lane?: string;
    /** Nested board: the card it goes under (an id, or what a person calls it). (1–200 characters) */
    under?: string;
  }): Promise<{
    revision: number;
    rev: number;
    ok?: boolean;
    warnings?: string[];
    refused?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
}

declare namespace slatebox.slates {
  /** Create a slate. Omitting kind creates a playable decision map from a brief of up to 160 characters. kind diagram makes editable notes and connections from your own steps (up to 1200 characters, connect two steps with → or ->) or from a named source. The token owner owns the new private slate. @scope slates:write */
  function create(input: {
    kind?: "map";
    /** (1–160 characters) */
    brief: string;
  } | {
    kind: "diagram";
    source?: "sign-in-outage" | "call-status" | "interview-notes" | "friday-launch";
    /** Plain text, including multiple lines. Connect two named steps using → or ->. Use up to 24 distinct notes including source notes. (1–1200 characters) */
    brief: string;
  }): Promise<({
    shareId: string;
    url: string;
    workshop: Workshop;
    [key: string]: unknown;
  } | {
    shareId: string;
    url: string;
    diagram: DiagramSummary;
    [key: string]: unknown;
  }) & { mode: "save" }>;
}

declare namespace slatebox.slates {
  /** To Mermaid. Write a slate you can open as Mermaid text: notes and lines as a flowchart (direction from the layout; shapes, labels, arrow ends and dashed, thick or hidden lines kept; a note drawn behind notes it holds becomes a subgraph of them; a workshop's lanes become subgraphs of cards), a mind map as a mindmap, a launch plan as a Gantt chart (format gantt, start is its first day). Returns the text, the same as a Markdown code block, and for a public slate its plain-text address (/slates/<id>.mmd). A public slate reads without a token. What Mermaid cannot say is named in warnings: dashed lines are written as Mermaid's one broken style (dotted), a line with an arrow only at its start is written from its other end, and a line with an end on the open canvas is left out. @scope slates:read */
  function exportMermaid(input: {
    /** The slate ID from its address: /canvas/<shareId>. (1–80 characters) */
    shareId: string;
    /** auto: a mind map that is one tree as mindmap, anything else as flowchart. (default "auto") */
    format?: "auto" | "flowchart" | "mindmap" | "gantt";
    /** Also write each note's colours (style lines). (default false) */
    styles?: boolean;
    /** A Gantt chart's first day, YYYY-MM-DD (default today). */
    start?: string;
  }): Promise<{
    shareId: string;
    /** (at least 0) */
    revision: number;
    name?: string;
    format: "flowchart" | "mindmap" | "gantt";
    /** The formats this slate can be written as. */
    formats?: string[];
    mermaid: string;
    /** The Mermaid in a ```mermaid code block. */
    markdown: string;
    notes?: number;
    lines?: number;
    subgraphs?: number;
    warnings?: string[];
    /** The plain-text address of a public slate's Mermaid; null otherwise. */
    publicUrl?: string | null;
    [key: string]: unknown;
  }>;
}

declare namespace slatebox.slates {
  /** Read a slate. Read a slate you can open: every note with every key a write sets, its connectors, what you may do here (access), its address, comments, conversation starters and, on a workshop or map, the workshop with its own revision (the one workshop and map edits use) and what it takes in plain words (workshop.can). revision is the slate's save count: send it as expectedRevision with an edit, and the edit is refused only if a note it changes was changed since. Select notes with ids, within, groupId or q (the notes a write naming that text would change) and keys with fields; page with cursor. include=full adds the slate as the engine loads it. A public slate reads without a token. @scope slates:read */
  function get(input: {
    /** The slate ID from its address: /canvas/<shareId>. (1–80 characters) */
    shareId: string;
    include?: "full";
    /** Comma-separated note keys to return (id always comes): any key a write sets, and image and comments. */
    fields?: string;
    /** Comma-separated note IDs: only these notes. */
    ids?: string;
    /** x,y,width,height: only notes lying wholly inside this rectangle. */
    within?: string;
    /** Only the notes of this group. (at least 1 characters) */
    groupId?: string;
    /** Notes whose whole text is this, ignoring case and extra spaces: the notes a write naming this text would change. (1–10000 characters) */
    q?: string;
    /** With q: contains searches inside the text. */
    match?: "exact" | "contains";
    /** Notes per page (default 100). A page also stops at a size ceiling. (1 to 500) */
    limit?: number;
    /** nextCursor from the page before. (1–2000 characters) */
    cursor?: string;
  }): Promise<SlateRead>;
}

declare namespace slatebox.slates {
  /** Draw Mermaid. Draw a Mermaid flowchart, mind map or Gantt chart as real notes and lines, laid out in the diagram's direction (subgraphs and Gantt sections become frames). With shareId the diagram is added beside what that slate holds (you must be able to edit it; everyone on the slate sees it drawn); without, it becomes a new private slate of yours named name (or the diagram's title). Mermaid in a Markdown ```mermaid block is read too. Another kind of diagram is refused with 422 mermaid_unsupported; a mistake with 400 mermaid_invalid naming its line; a diagram past a slate's limits (1,000 notes counting frames, 5,000 lines, frames 50 deep, or a subgraph too big for one frame) with 422 mermaid_too_large. Send mode "preview" to see what would be drawn without saving. @scope slates:write @modes save|preview */
  function importMermaid(input: {
    /** Mermaid source (flowchart/graph, mindmap or gantt), or Markdown holding a ```mermaid block. (1–100000 characters) */
    mermaid: string;
    /** Add to this slate. Leave out to make a new private slate. (1–80 characters) */
    shareId?: string;
    /** The new slate's name (without shareId). (1–200 characters) */
    name?: string;
    /** preview returns what would change and saves nothing. (default "save") */
    mode?: "save" | "preview";
  }): Promise<({
    ok: boolean;
    mode: "save" | "preview";
    shareId: string | null;
    url?: string | null;
    /** (at least 0) */
    revision?: number;
    kind: "flowchart" | "mindmap" | "gantt";
    notes: number;
    frames?: number;
    lines: number;
    /** The ids of the notes drawn (frames first). */
    created?: string[];
    warnings?: string[];
    message: string;
    [key: string]: unknown;
  }) & { mode: "save" | "preview" }>;
}

declare namespace slatebox.slates {
  /** Share by invitation. The registered owner turns on an unlisted link. Changing its role keeps the address. Public slates are changed in the Share dialog. Anyone holding the address gets the role. @scope slates:share @openWorld @confirm @idempotent */
  function issueInvite(input: {
    /** The slate ID from its address: /canvas/<shareId>. (1–80 characters) */
    shareId: string;
    role: "read" | "comment" | "edit";
  }): Promise<(Invitation) & { mode: "save" }>;
}

declare namespace slatebox.slates {
  /** Unshare. Withdraws exactly this invitation. Named team grants stay. Repeating the request confirms the same withdrawal; a newer invitation is never withdrawn by an old command. @scope slates:share @destructive @idempotent */
  function revokeInvite(input: {
    /** The slate ID from its address: /canvas/<shareId>. (1–80 characters) */
    shareId: string;
    inviteId: string;
  }): Promise<({
    shareId: string;
    inviteId: string;
    revoked: true;
    mode?: "save";
    [key: string]: unknown;
  }) & { mode: "save" }>;
}

declare namespace slatebox.team {
  /** Export team. For a team admin: a one-time address (15 minutes) to download everything the team owns as one archive, in the open team export format: slates with their boards and smart components, recent versions and events, comments, presentations, files, people and roles, published-link settings, AI connections (never keys) and the names and scopes of API tokens (never secrets). POST to downloadUrl to download; send a passphrase (form or JSON field "passphrase", the Slatebox-Export-Passphrase-Base64 header as base64url of its UTF-8 bytes, or the Slatebox-Export-Passphrase header when it is plain ASCII; at least 12 characters, not starting or ending with a space) to encrypt the archive. The archive is signed and checked; import it with teamImports.start on any Slatebox server. @scope team:export @confirm */
  function export(input: Record<string, unknown>): Promise<({
    downloadUrl: string;
    method: "POST";
    expiresAt: string;
    team?: {
      name?: string;
      [key: string]: unknown;
    };
    members?: number;
    slates?: number;
    passphrase?: Record<string, unknown>;
    limits?: Record<string, unknown>;
    [key: string]: unknown;
  }) & { mode: "save" }>;
}

declare namespace slatebox.teamImports {
  /** Confirm import. For an administrator of this server: makes a pending import's team live. Its slates and presentations get back the visibility they had (public, unlisted or private). With invite true, each person whose address the source had verified, and no account here uses in any letter case, gets an email to claim their placeholder; the answer lists addresses that already have an account (they must agree to move) and addresses the source had not verified (invite each with teamImports.invite once you have checked it). Board rules stay switched off until a team admin reviews them. @scope team:import @confirm */
  function confirm(input: {
    importId: string;
    /** (default false) */
    invite?: boolean;
  }): Promise<({
    importId: string;
    state: "confirmed";
    teamId: string;
    invited?: {
      sent?: number;
      needsConsent?: string[];
      mailDisabled?: number;
      unverified?: string[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }) & { mode: "save" }>;
}

declare namespace slatebox.teamImports {
  /** Discard import. For an administrator of this server: deletes a pending import's hidden team and everything the import wrote (slates, files, people, settings). @scope team:import @destructive */
  function discard(input: {
    importId: string;
  }): Promise<({
    importId: string;
    state: "discarded";
    [key: string]: unknown;
  }) & { mode: "save" }>;
}

declare namespace slatebox.teamImports {
  /** Import. For an administrator of this server: one import, with its report while it is pending or confirmed. @scope team:import */
  function get(input: {
    importId: string;
  }): Promise<{
    importId: string;
    state: "running" | "pending" | "confirming" | "confirmed" | "discarding" | "discarded" | "failed";
    teamId?: string;
    teamName?: string;
    createdAt?: string;
    expiresAt?: string;
    failure?: {
      code?: string;
      message?: string;
      [key: string]: unknown;
    };
    invited?: {
      sent?: number;
      needsConsent?: string[];
      mailDisabled?: number;
      unverified?: string[];
      [key: string]: unknown;
    };
    /** What the import made: the team, the source (instance, team, when, and whether a key this server knows signed it), counts per section with each skip and its reason, the people (placeholders until invited), the slates with their content hashes, the files, rewritten links, board rules switched off, AI connections (without keys) and the tokens to make again. */
    report?: {
      team?: Record<string, unknown>;
      source?: Record<string, unknown>;
      sections?: Record<string, {
        created?: number;
        skipped?: number;
        [key: string]: unknown;
      }>;
      people?: Array<Record<string, unknown>>;
      slates?: Array<Record<string, unknown>>;
      files?: Record<string, unknown>;
      links?: Record<string, unknown>;
      rulesSwitchedOff?: number;
      ai?: Record<string, unknown>;
      tokens?: Array<Record<string, unknown>>;
      skipped?: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;
}

declare namespace slatebox.teamImports {
  /** Invite person. For an administrator of this server: after you have checked an address that a confirmed import listed as unverified (the source had not verified it), sends that person the email to claim their placeholder. An address any account here already uses, in any letter case, is not invited: that person must agree to move. @scope team:import @confirm */
  function invite(input: {
    importId: string;
    /** (3–320 characters) */
    email: string;
  }): Promise<({
    importId: string;
    email: string;
    outcome: "sent" | "needs_consent" | "mail_disabled" | "already_invited";
    [key: string]: unknown;
  }) & { mode: "save" }>;
}

declare namespace slatebox.teamImports {
  /** Imports. For an administrator of this server: recent team imports, pending ones first to confirm or discard. @scope team:import */
  function list(input: Record<string, unknown>): Promise<{
    imports: Array<{
      importId: string;
      state: "running" | "pending" | "confirming" | "confirmed" | "discarding" | "discarded" | "failed";
      teamId?: string;
      teamName?: string;
      createdAt?: string;
      expiresAt?: string;
      failure?: {
        code?: string;
        message?: string;
        [key: string]: unknown;
      };
      invited?: {
        sent?: number;
        needsConsent?: string[];
        mailDisabled?: number;
        unverified?: string[];
        [key: string]: unknown;
      };
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }>;
}

declare namespace slatebox.teamImports {
  /** Start import. For an administrator of this server: a one-time address (1 hour) to upload a team export to. POST the archive to uploadUrl as application/octet-stream, with its passphrase when it is encrypted: in the Slatebox-Export-Passphrase-Base64 header as base64url of its UTF-8 bytes (any passphrase), or in the Slatebox-Export-Passphrase header when it is plain ASCII. The upload becomes a new hidden team, with new ids for everything, people as placeholders who cannot sign in, slates private, board rules switched off, no keys and no tokens; the answer is the report. Confirm or discard it with teamImports.confirm or teamImports.discard; a pending import is discarded after 14 days. @scope team:import */
  function start(input: Record<string, unknown>): Promise<({
    uploadUrl: string;
    method: "POST";
    contentType?: string;
    passphraseHeader?: string;
    passphraseHeaderBase64?: string;
    expiresAt: string;
    maxBytes?: number;
    [key: string]: unknown;
  }) & { mode: "save" }>;
}

/** Every refusal. code is stable; message is a server-written sentence; details carries ids and codes. */
declare class SlateboxError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly retryAfter?: number;
}

/** Add a library component (components.list) to this slate, the way the chat's Add does: its board goes beside the slate's notes and boards, covering none, and open pages draw it at once. The answer names its boardId (main for a slate's first board). A slate holds up to 8 boards; past that, 409 component_opens_new_slate. Preview to see the board and where it goes; saving requires an Idempotency-Key. */
interface AddComponentPlan {
  /** (at least 1 characters) */
  message: string;
  /** (1–1 items) */
  operations: Array<{
    kind: "add_component";
    /** The library entry to add (components.list ids). */
    component: "now-next-later" | "pros-cons" | "must-should-could" | "decision-path" | "retro" | "triage" | "team-board" | "launch-plan" | "customer-go-live" | "hiring-plan" | "sort-evidence" | "discovery-tree" | "break-down-problem" | "incident-review" | "impact-effort" | "reorg-sandbox" | "goals-owners" | "sales-pipeline" | "budget";
    /** What it is about: names the board ("Retro: Q3 launch"). (1–100 characters) */
    topic?: string;
    /** The slate revision you read (slates.get). (at least 0) */
    expectedRevision: number;
  }>;
  [key: string]: unknown;
}

interface CanvasPlan {
  /** A concise, natural response describing exactly what will change. Do not claim an operation that is absent from operations. */
  message: string;
  /** (1–50 items) */
  operations: Array<{
    kind: "add_nodes" | "update_nodes" | "delete_nodes" | "duplicate_nodes" | "connect_nodes" | "disconnect_nodes" | "update_connections" | "arrange_nodes" | "update_slate";
    /** (1 to 20) */
    count?: number;
    shape?: ("rectangle" | "roundedrectangle" | "ellipse" | "circle" | "star" | "triangle" | "pentagon" | "hexagon" | "octagon" | "trapezium" | "parallelogram" | "rarrow" | "larrow" | "diamond" | "stickynote") | {
      /** (1–60 characters) */
      name: string;
      /** Path data: commands and plain numbers only. (1–8000 characters) */
      d: string;
      /** evenodd when the shape has holes. */
      fillRule?: "nonzero" | "evenodd";
      /** The shape library entry it came from. */
      ref?: {
        id: string;
        /** (at most 60 characters) */
        name?: string;
      };
    };
    /** (at most 10000 characters) */
    text?: string;
    /** (-1000000 to 1000000) */
    x?: number;
    /** (-1000000 to 1000000) */
    y?: number;
    /** (20 to 5000) */
    width?: number;
    /** (20 to 5000) */
    height?: number;
    /** add_nodes: text (no fill or border) or sticky (a sticky note), as the note toolbar makes them. Gives the shape when none is given. */
    preset?: "text" | "sticky";
    /** add_nodes and duplicate_nodes: new note ids (1 to 64 letters, digits, _ or -), which later operations in the plan may name. connect_nodes: ids for the new connectors, one per pair. An id already in use is refused. */
    ids?: string[];
    connectionIds?: string[];
    /** (0 to 2000) */
    gap?: number;
    /** duplicate_nodes: how far the copies sit from the notes copied; 20, 20 when left out. */
    offset?: {
      x: number;
      y: number;
    };
    /** add_nodes: where to put the notes. With x and y, only arrangement and gap apply. connect: true with relativeTo makes notes that copy that note's look and are joined to it, 75 from its edge, as the canvas's connection handles do. */
    placement?: {
      relativeTo?: string;
      direction?: "left" | "right" | "above" | "below" | "center";
      arrangement?: "row" | "column" | "grid";
      /** (0 to 2000) */
      gap?: number;
      connect?: boolean;
    };
    /** add_nodes: note keys for the new notes. connect_nodes: connector keys for the new connectors. */
    style?: {
      /** (-360 to 360) */
      rotationAngle?: number;
      /** A CSS colour, such as #336699. (at most 64 characters) */
      backgroundColor?: string;
      /** A CSS colour, such as #336699. (at most 64 characters) */
      foregroundColor?: string;
      /** A CSS colour, such as #336699. (at most 64 characters) */
      borderColor?: string;
      /** (0 to 100) */
      borderWidth?: number;
      /** (0 to 1) */
      borderOpacity?: number;
      borderStyle?: "solid" | "dashed" | "dotted" | "combo";
      /** (0 to 1) */
      opacity?: number;
      fontFamily?: "Manrope" | "Arial" | "Times New Roman" | "Georgia" | "Courier Prime" | "Indie Flower" | "Abril Fatface" | "Bangers" | "Caveat" | "EB Garamond" | "Fredoka One" | "Graduate" | "Gravitas One" | "IBM Plex Mono" | "IBM Plex Sans" | "IBM Plex Serif" | "Lemon" | "Lora" | "Nixie One" | "Noto Sans" | "Open Sans" | "Poppins" | "PT Sans" | "PT Sans Narrow" | "PT Serif" | "Permanent Marker" | "Rammetto One" | "Roboto" | "Roboto Condensed" | "Roboto Mono" | "Roboto Slab" | "Rubik" | "Titan One" | "Urbanist";
      /** (1 to 500) */
      fontSize?: number;
      textXAlign?: "left" | "middle" | "right";
      textYAlign?: "top" | "middle" | "bottom";
      animation?: "mystery" | "fadeSlideUp" | "fadeSlideDown" | "bumpUpIn" | "bumpDownIn" | "impactSlide" | "powerSmash" | "torqueWarp" | "unroll" | "smoke" | "fractured" | "flux" | "springy" | "breathe" | "pulse" | "rotate" | null;
      /** (0 to 1) */
      textOpacity?: number;
      /** An http or https address. (at most 2000 characters) */
      link?: string | null;
      effect?: "dropShadow" | "blur" | "outline" | "postItNote" | "pencil" | null;
      groupId?: string | null;
      /** (1–200 characters) */
      templateCategory?: string | null;
      hiddenControls?: Array<"color" | "text" | "shape" | "picture" | "effects" | "ask">;
      locked?: boolean;
      /** (at most 500 characters) */
      label?: string;
      /** A CSS colour, such as #336699. (at most 64 characters) */
      lineColor?: string;
      /** (0.1 to 100) */
      lineWidth?: number;
      /** (0 to 1) */
      lineOpacity?: number;
      lineType?: "bezier" | "orthogonal" | "straight" | "linear" | "curved";
      lineCurveType?: "cubic" | "quadratic";
      /** (0 to 1) */
      lineCurviness?: number;
      lineDash?: "solid" | "dashed" | "dotted";
      /** (0.05 to 0.95) */
      labelPosition?: number;
      showParentArrow?: boolean;
      showChildArrow?: boolean;
    };
    /** Name notes one way: ids, text (the whole text, ignoring case and extra spaces; match: "contains" to search), within a rectangle, groupId, or all: true. A text selector matching several notes also needs all: true. */
    target?: {
      /** (at least 1 items) */
      ids?: string[];
      text?: string;
      match?: "exact" | "contains";
      all?: true;
      within?: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      groupId?: string;
    };
    /** Name notes one way: ids, text (the whole text, ignoring case and extra spaces; match: "contains" to search), within a rectangle, groupId, or all: true. A text selector matching several notes also needs all: true. */
    from?: {
      /** (at least 1 items) */
      ids?: string[];
      text?: string;
      match?: "exact" | "contains";
      all?: true;
      within?: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      groupId?: string;
    };
    /** Name notes one way: ids, text (the whole text, ignoring case and extra spaces; match: "contains" to search), within a rectangle, groupId, or all: true. A text selector matching several notes also needs all: true. connect_nodes may instead give {point: {x, y}} for a connector with a free end. */
    to?: {
      /** (at least 1 items) */
      ids?: string[];
      text?: string;
      match?: "exact" | "contains";
      all?: true;
      within?: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      groupId?: string;
      point?: {
        x: number;
        y: number;
      };
    };
    /** arrange_nodes: row, column, grid, circle; align-* and distribute-* as the canvas aligns by what you see; tidy moves notes apart until none overlaps; tree lays connected notes out in layers under their root. */
    layout?: "row" | "column" | "grid" | "circle" | "align-left" | "align-center" | "align-right" | "align-top" | "align-middle" | "align-bottom" | "distribute-horizontal" | "distribute-vertical" | "tidy" | "tree";
    /** update_nodes: note keys (and order: front or back). update_connections: connector keys. update_slate: name, description, background, mindMapMode, autoResizeNodesBasedOnText, showGrid, snapToObjects, defaultLineColor. */
    changes?: {
      /** The note's text. (at most 10000 characters) */
      text?: string;
      /** A shape registered with the engine (custom shapes read back as custom:<name>). */
      shape?: ("rectangle" | "roundedrectangle" | "ellipse" | "circle" | "star" | "triangle" | "pentagon" | "hexagon" | "octagon" | "trapezium" | "parallelogram" | "rarrow" | "larrow" | "diamond" | "stickynote") | {
        /** (1–60 characters) */
        name: string;
        /** Path data: commands and plain numbers only. (1–8000 characters) */
        d: string;
        /** evenodd when the shape has holes. */
        fillRule?: "nonzero" | "evenodd";
        /** The shape library entry it came from. */
        ref?: {
          id: string;
          /** (at most 60 characters) */
          name?: string;
        };
      };
      /** Left edge on the canvas. (-1000000 to 1000000) */
      x?: number;
      /** Top edge on the canvas. (-1000000 to 1000000) */
      y?: number;
      /** Width in canvas units. (20 to 5000) */
      width?: number;
      /** Height in canvas units. (20 to 5000) */
      height?: number;
      /** Rotation in degrees. (-360 to 360) */
      rotationAngle?: number;
      /** Fill colour. (at most 64 characters) */
      backgroundColor?: string;
      /** Text colour. (at most 64 characters) */
      foregroundColor?: string;
      /** Border colour. (at most 64 characters) */
      borderColor?: string;
      /** Border width. (0 to 100) */
      borderWidth?: number;
      /** Border opacity from 0 to 1. (0 to 1) */
      borderOpacity?: number;
      /** Border line style. */
      borderStyle?: "solid" | "dashed" | "dotted" | "combo";
      /** Note opacity from 0 to 1. (0 to 1) */
      opacity?: number;
      /** A font this instance offers. */
      fontFamily?: "Manrope" | "Arial" | "Times New Roman" | "Georgia" | "Courier Prime" | "Indie Flower" | "Abril Fatface" | "Bangers" | "Caveat" | "EB Garamond" | "Fredoka One" | "Graduate" | "Gravitas One" | "IBM Plex Mono" | "IBM Plex Sans" | "IBM Plex Serif" | "Lemon" | "Lora" | "Nixie One" | "Noto Sans" | "Open Sans" | "Poppins" | "PT Sans" | "PT Sans Narrow" | "PT Serif" | "Permanent Marker" | "Rammetto One" | "Roboto" | "Roboto Condensed" | "Roboto Mono" | "Roboto Slab" | "Rubik" | "Titan One" | "Urbanist";
      /** Font size. (1 to 500) */
      fontSize?: number;
      /** Horizontal text alignment. */
      textXAlign?: "left" | "middle" | "right";
      /** Vertical text alignment. */
      textYAlign?: "top" | "middle" | "bottom";
      /** An entrance or looping animation, or null for none. */
      animation?: "mystery" | "fadeSlideUp" | "fadeSlideDown" | "bumpUpIn" | "bumpDownIn" | "impactSlide" | "powerSmash" | "torqueWarp" | "unroll" | "smoke" | "fractured" | "flux" | "springy" | "breathe" | "pulse" | "rotate" | null;
      /** Text opacity from 0 to 1. (0 to 1) */
      textOpacity?: number;
      /** A web address the note opens (http or https), or null to remove it. (at most 2000 characters) */
      link?: string | null;
      /** A note effect such as dropShadow or postItNote, or null for none. */
      effect?: "dropShadow" | "blur" | "outline" | "postItNote" | "pencil" | null;
      /** Notes sharing a groupId select and move as one group; null takes the note out of its group. */
      groupId?: string | null;
      /** Only when asked to make a note a template's category heading: names the bucket the template's AI conversation files notes under, and presentations skip the note. Not for grouping or labelling notes by theme (use groupId or text). null makes it an ordinary note. (1–200 characters) */
      templateCategory?: string | null;
      /** Controls left off this note's style bar: color (fill and border), text (text colour, size, alignment, font), shape, picture, effects, ask. The list replaces the note's whole list, so to hide one more, send the ones already hidden (the summary lists them) plus it. An empty list shows them all. Chat and exec can still change the note. */
      hiddenControls?: Array<"color" | "text" | "shape" | "picture" | "effects" | "ask">;
      /** A locked note cannot be moved, changed or deleted until it is unlocked. */
      locked?: boolean;
      order?: "front" | "back";
      /** (at most 500 characters) */
      label?: string;
      /** A CSS colour, such as #336699. (at most 64 characters) */
      lineColor?: string;
      /** (0.1 to 100) */
      lineWidth?: number;
      /** (0 to 1) */
      lineOpacity?: number;
      lineType?: "bezier" | "orthogonal" | "straight" | "linear" | "curved";
      lineCurveType?: "cubic" | "quadratic";
      /** (0 to 1) */
      lineCurviness?: number;
      lineDash?: "solid" | "dashed" | "dotted";
      /** (0.05 to 0.95) */
      labelPosition?: number;
      showParentArrow?: boolean;
      showChildArrow?: boolean;
      ends?: "follow" | "pinned";
      fromEnd?: "follow" | "pinned" | "top" | "right" | "bottom" | "left";
      toEnd?: "follow" | "pinned" | "top" | "right" | "bottom" | "left";
      /** (1–200 characters) */
      toNote?: string;
      /** (1–200 characters) */
      fromNote?: string;
      toPoint?: {
        x: number;
        y: number;
      };
      fromPoint?: {
        x: number;
        y: number;
      };
      /** (1–200 characters) */
      name?: string;
      /** (at most 5000 characters) */
      description?: string;
      background?: {
        /** A CSS colour, such as #336699. (at most 64 characters) */
        color: string;
        gradient?: {
          type: "linear" | "radial";
          /** (2–8 items) */
          colors: string[];
          direction?: "horizontal" | "vertical" | "diagonal";
        };
      };
      mindMapMode?: boolean;
      autoResizeNodesBasedOnText?: boolean;
      showGrid?: boolean;
      snapToObjects?: boolean;
      /** A CSS colour, such as #336699. (at most 64 characters) */
      defaultLineColor?: string;
    };
  }>;
}

interface DiagramSummary {
  name: string;
  description: string;
  /** (at least 0) */
  nodeCount: number;
  nodes: Array<Record<string, unknown>>;
  connections: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface Invitation {
  shareId: string;
  inviteId: string;
  role: "read" | "comment" | "edit";
  url: string;
  [key: string]: unknown;
}

interface MapAuthoringPlan {
  /** (at least 1 characters) */
  message: string;
  /** (1–1 items) */
  operations: Array<{
    kind: "add_map_branch";
    fromStationId: string;
    /** (1–80 characters) */
    label: string;
    /** (1–160 characters) */
    outcome: string;
    /** (at least 0) */
    expectedRevision: number;
    /** The board (slates.get boards[].id; main is the first). Required when the slate holds several boards. */
    boardId?: string;
  } | {
    kind: "update_map_outcome";
    stationId: string;
    /** (1–160 characters) */
    outcome: string;
    /** (at least 0) */
    expectedRevision: number;
    /** The board (slates.get boards[].id; main is the first). Required when the slate holds several boards. */
    boardId?: string;
  }>;
  [key: string]: unknown;
}

interface PresentationOrderPlan {
  /** (at least 1 characters) */
  message: string;
  /** (1–1 items) */
  operations: Array<{
    kind: "set_presentation_order";
    /** All lane or station IDs exactly once, in presentation order. Board positions and routes stay intact. (2–5 items) */
    laneIds: string[];
    /** (at least 0) */
    expectedRevision: number;
    /** The board (slates.get boards[].id; main is the first). Required when the slate holds several boards. */
    boardId?: string;
  }>;
  [key: string]: unknown;
}

interface SlateRead {
  shareId: string;
  /** The slate's save count. Send it as expectedRevision with an edit; a workshop or map edit uses workshop.revision. (at least 0) */
  revision: number;
  name: string;
  description: string;
  /** The address you open the slate at. */
  url: string;
  /** The published picture of this board and its embed code, or null when none is published. */
  embed: {
    url?: string;
    code?: string;
    [key: string]: unknown;
  } | null;
  access: {
    visibility: "private" | "unlisted" | "public";
    yourRole: "READ" | "COMMENT" | "EDIT";
    isOwner: boolean;
    canEdit: boolean;
    /** The owner only: the role the share link gives, or null. */
    linkRole?: string | null;
    [key: string]: unknown;
  };
  /** The brief the slate was created from. */
  brief: string | null;
  /** As update_slate takes it: {color, gradient?}. */
  background: Record<string, unknown> | null;
  bounds: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    [key: string]: unknown;
  } | null;
  /** Notes the selection matches, on every page. (at least 0) */
  nodeCount: number;
  nodes: Array<{
    id: string;
    /** The note's text. */
    text?: unknown;
    /** A shape registered with the engine (custom shapes read back as custom:<name>). */
    shape?: unknown;
    /** Left edge on the canvas. */
    x?: unknown;
    /** Top edge on the canvas. */
    y?: unknown;
    /** Width in canvas units. */
    width?: unknown;
    /** Height in canvas units. */
    height?: unknown;
    /** Rotation in degrees. */
    rotationAngle?: unknown;
    /** Fill colour. */
    backgroundColor?: unknown;
    /** Text colour. */
    foregroundColor?: unknown;
    /** Border colour. */
    borderColor?: unknown;
    /** Border width. */
    borderWidth?: unknown;
    /** Border opacity from 0 to 1. */
    borderOpacity?: unknown;
    /** Border line style. */
    borderStyle?: unknown;
    /** Note opacity from 0 to 1. */
    opacity?: unknown;
    /** A font this instance offers. */
    fontFamily?: unknown;
    /** Font size. */
    fontSize?: unknown;
    /** Horizontal text alignment. */
    textXAlign?: unknown;
    /** Vertical text alignment. */
    textYAlign?: unknown;
    /** An entrance or looping animation, or null for none. */
    animation?: unknown;
    /** Text opacity from 0 to 1. */
    textOpacity?: unknown;
    /** A web address the note opens (http or https), or null to remove it. */
    link?: unknown;
    /** A note effect such as dropShadow or postItNote, or null for none. */
    effect?: unknown;
    /** Notes sharing a groupId select and move as one group; null takes the note out of its group. */
    groupId?: unknown;
    /** Only when asked to make a note a template's category heading: names the bucket the template's AI conversation files notes under, and presentations skip the note. Not for grouping or labelling notes by theme (use groupId or text). null makes it an ordinary note. */
    templateCategory?: unknown;
    /** Controls left off this note's style bar: color (fill and border), text (text colour, size, alignment, font), shape, picture, effects, ask. The list replaces the note's whole list, so to hide one more, send the ones already hidden (the summary lists them) plus it. An empty list shows them all. Chat and exec can still change the note. */
    hiddenControls?: unknown;
    /** A locked note cannot be moved, changed or deleted until it is unlocked. */
    locked?: unknown;
    image?: string | null;
    comments?: {
      count: number;
      unresolved: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;
  /** The connectors that start at a note on this page. */
  connections: Array<{
    id: string;
    from: string;
    to: string | null;
    /** Text shown on the connector. */
    label?: unknown;
    /** Line colour. */
    lineColor?: unknown;
    /** Line width. */
    lineWidth?: unknown;
    /** Line opacity from 0 to 1. */
    lineOpacity?: unknown;
    /** Path style. */
    lineType?: unknown;
    /** Curve type. */
    lineCurveType?: unknown;
    /** How much the line bends. */
    lineCurviness?: unknown;
    /** Solid, dashed or dotted line. */
    lineDash?: unknown;
    /** Where the label sits along the line, from near its start (0.05) to near its end (0.95); the middle (0.5) when unset. */
    labelPosition?: unknown;
    /** Arrowhead at the starting note. */
    showParentArrow?: unknown;
    /** Arrowhead at the far end. */
    showChildArrow?: unknown;
    /** Both ends that are on notes: follow (each end takes the shortest way round its note as things move) or pinned (each end stays at the spot on its note's edge that faces the line's other end, where a following end sits). */
    ends?: unknown;
    /** The starting end: follow, pinned (at the spot on the note's edge facing the line's other end), or pinned to the middle of the note's top, right, bottom or left side. */
    fromEnd?: unknown;
    /** The far end: follow, pinned (at the spot on the note's edge facing the line's other end), or pinned to the middle of the note's top, right, bottom or left side. Not for a free end. */
    toEnd?: unknown;
    /** Reconnect the far end to this note (its id). A free end is attached to it. The connector keeps its id. */
    toNote?: unknown;
    /** Reconnect the starting end to this note (its id); the connector then belongs to that note and keeps its id. */
    fromNote?: unknown;
    /** Leave the far end free at this point on the canvas (a saved point that stays put). Detaches it from its note if it is on one; moves it if it is already free. */
    toPoint?: unknown;
    /** Leave the starting end free at this point. The connector then belongs to the note at its far end, its arrows kept as drawn. A connector keeps at least one end on a note. */
    fromPoint?: unknown;
    [key: string]: unknown;
  }>;
  /** Pass as cursor for the next page; null on the last. */
  nextCursor: string | null;
  comments: {
    count: number;
    unresolved: number;
    [key: string]: unknown;
  };
  conversation: {
    /** Whether you may use this slate’s conversation. */
    available: boolean;
    /** Up to three messages known to work here; select is the part to type over. */
    starters: Array<{
      label?: string;
      text: string;
      select?: number[];
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  workshop?: Workshop;
  /** Every board on the slate, first (main) first: {id, title, kind, origin, revision} and the same read as workshop. Name one by its id (boardId) in a workshop operation; a slate of several boards requires it. */
  boards?: Array<Record<string, unknown>>;
  /** include=full: the slate as the engine loads it {options, nodes, shareId}. */
  document?: Record<string, unknown>;
  [key: string]: unknown;
}

interface Workshop {
  title: string;
  kind: "lanes" | "release-plan" | "customer-interviews" | "experiment-budget" | "map" | "launch-plan" | "pipeline" | "budget" | "hiring-plan" | "nest";
  /** Launch plans: launch day, and the day the last task ends (name: what the plan calls its line, such as go-live). */
  launch?: {
    day: number;
    finish: number;
    name?: string;
    [key: string]: unknown;
  };
  /** Launch and hiring plans with dates: the plan's first day (YYYY-MM-DD); every day is an offset from it. */
  clock?: {
    origin: string;
    [key: string]: unknown;
  };
  /** Hiring plans: cash, monthly burn without new hires, role bands (cost per band, never per person), the funding round, and runway. */
  hiring?: {
    cash: number;
    burn: number;
    currency: string;
    weeks: number;
    /** Months of runway with these hires. */
    runway: number;
    bands: Array<{
      id: string;
      label: string;
      monthly: number;
      lane: string;
      [key: string]: unknown;
    }>;
    funding?: {
      day: number;
      amount: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Pipelines: the target, and the forecast (Σ amount × chance, plus won). */
  forecast?: {
    target: number;
    currency: string;
    value: number;
    [key: string]: unknown;
  };
  /** Budgets: the total the teams split, and the step money moves in. */
  budget?: {
    total: number;
    currency: string;
    step: number;
    [key: string]: unknown;
  };
  /** The starter experience this board is, or null. */
  experience: string | null;
  /** What this board keeps as it came, in the sentence it answers a change with; null where it may change. */
  fixed: {
    lanes: string | null;
    cards: string | null;
    [key: string]: unknown;
  };
  /** (at least 0) */
  revision: number;
  /** All lane or station IDs exactly once, in presentation order. Board positions and routes stay intact. (2–5 items) */
  presentationOrder: string[];
  lanes: Array<{
    id: string;
    label: string;
    capacity?: number;
    /** The line under the lane on the canvas: "2 of 3", "4 / 8 points", "$300 · ...". */
    caption: string;
    /** Cards in the lane. */
    held: number;
    /** Release plans: points planned in this release. */
    load?: number;
    budget?: {
      amount: number;
      description: string;
      [key: string]: unknown;
    };
    /** Pipelines: the chance a deal in this open stage is won, 0 to 1. */
    probability?: number;
    /** Pipelines: the stage that holds won or lost deals. */
    role?: "won" | "lost";
    /** Budgets: what this team is given. */
    allocation?: number;
    /** Budgets: what this team’s line items add up to. */
    committed?: number;
    /** Budgets: the least this team may be given. */
    floor?: number;
    /** Budgets: the most this team may be given. */
    cap?: number;
    outcome?: string;
    next?: string[];
    position?: {
      column: number;
      row: number;
      [key: string]: unknown;
    };
    image?: {
      src: string;
      alt: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;
  cards: Array<{
    id: string;
    label: string;
    laneId: string;
    allowedLaneIds?: string[];
    legalLaneIds: string[];
    /** Release plans: the feature’s effort. */
    points?: number;
    /** Release plans and launch plans: the cards it waits on. */
    dependsOn?: string[];
    /** Launch plans: the days the task takes. */
    duration?: number;
    /** Launch plans: the days it waits after what it waits on. */
    lag?: number;
    /** Launch plans: the day it starts (derived). */
    start?: number;
    /** Launch plans: the day it ends (derived). */
    end?: number;
    /** Launch plans: the days it can slip without moving the finish. */
    slack?: number;
    /** Launch plans: on the critical path. */
    critical?: boolean;
    /** Dated plans: the calendar day it starts (an offset from clock.origin). */
    from?: number;
    /** Dated plans: the calendar day after its last day; a hire's first day. */
    to?: number;
    /** Hiring plans: the hire's role band. */
    band?: string;
    /** Pipelines and budgets: the deal’s or line item’s amount. */
    amount?: number;
    [key: string]: unknown;
  }>;
  /** The lines joined to its cards: fromId and toId are card IDs, or note IDs of the slate. A line whose end is free on the canvas has toPoint (canvas coordinates) in place of toId. */
  lines?: Array<{
    id: string;
    fromId: string;
    toId?: string;
    toPoint?: {
      x: number;
      y: number;
      [key: string]: unknown;
    };
    label?: string;
    [key: string]: unknown;
  }>;
  outcomes: Array<{
    id: string;
    label: string;
    cardId: string;
    laneId: string;
    present: boolean;
    text: string;
    [key: string]: unknown;
  }>;
  /** One per lane or step, in presentation order, as Present steps through them. */
  scenes: Array<{
    laneId: string;
    label: string;
    caption: string;
    cardIds: string[];
    outcomeIds: string[];
    nodeIds: string[];
    [key: string]: unknown;
  }>;
  /** The presentation someone is leading now, or null: step is the viewpoint everyone is on (-1 is the whole slate). */
  livePresentation: {
    sessionId?: string;
    step?: number;
    /** (at least 0) */
    revision?: number;
    expiresAt?: number;
    [key: string]: unknown;
  } | null;
  /** The operation kinds the operations route takes on this board. */
  operations?: string[];
  /** The edits workshop_edits takes on this board. */
  edits?: string[];
  /** What this board takes, in plain words, each with a phrase that does it: what a person sees under "What else can this board do?" with the board in focus. Make the change itself with workshop_edits. */
  can?: Array<{
    words: string;
    say: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/** Edit a workshop the way people do: add, move, rename and remove cards and lanes. Additions and changes save at once; an edit that removes a card, a lane, a dependency or an outcome waits for the person to agree. A refusal answers 409 edit_refused with the sentence a person sees (details.reason), details.editIndex and the board as it stands; nothing is saved. */
interface WorkshopEditsPlan {
  /** (at least 1 characters) */
  message: string;
  /** (1–1 items) */
  operations: Array<{
    kind: "workshop_edits";
    /** Applied in order, all or none, by the rules a person meets on the canvas. Name a card or lane by its id ({id}) or by what people call it ("the Proposal stage"). workshop.edits lists the edits this board takes. (1–50 items) */
    edits: Array<{
      kind: "rename_workshop";
      /** The new name, 1 to 120 characters of plain text. (1–120 characters) */
      title: string;
    } | {
      kind: "rename_lane";
      /** The lane or step. */
      lane: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The new name, 1 to 80 characters of plain text. (1–80 characters) */
      label: string;
    } | {
      kind: "rename_card";
      /** The card or token. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The new words, up to 80 characters of plain text. Empty makes an empty card, except on a launch plan, pipeline, budget, hiring plan or nest board, where a card is named: 1 to 80 characters. (0–80 characters) */
      label: string;
    } | {
      kind: "add_lane";
      /** The lane’s name. (1–80 characters) */
      label: string;
      /** How many cards it holds, 1 to 24. Leave it out for any number. (1 to 24) */
      capacity?: number;
    } | {
      kind: "remove_lane";
      /** The lane or step. */
      lane: string | {
        /** (1–64 characters) */
        id: string;
      };
    } | {
      kind: "add_card";
      /** The lane or step it starts in. */
      lane: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** What the card says. Left out, the card takes the board’s name for a new item: “New card”, “New hire”, “New task”, “New deal” (on a map, a token is numbered; a free card is “New stop”). (1–80 characters) */
      label?: string;
      /** Lane boards only: the lanes it may go in, including the one it starts in. Leave it out for any lane. (1–5 items) */
      allowedLanes?: Array<string | {
        /** (1–64 characters) */
        id: string;
      }>;
      /** Launch plan: days, 1 to 60 (2). (1 to 60) */
      duration?: number;
      /** Launch plan: days it waits. (0 to 120) */
      lag?: number;
      /** Launch plan: what it waits on. (0–3 items) */
      waitsOn?: Array<string | {
        /** (1–64 characters) */
        id: string;
      }>;
      /** Pipeline or budget: the amount. (0 to 1000000000) */
      amount?: number;
      /** Map: true for a card the paths don’t constrain, as a note dropped on a step becomes; left out, a token. */
      free?: boolean;
      /** Hiring plan: the role band (by id or name). Left out, the team’s first band. (1–40 characters) */
      band?: string;
      /** Nest board: the card it goes under. */
      under?: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** Nest board: what it is. (1–24 characters) */
      role?: string;
      /** Nest board: who said it. (1–60 characters) */
      source?: string;
    } | {
      kind: "remove_card";
      /** The card or token. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
    } | {
      kind: "move_card";
      /** The card or token. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** Where it goes. */
      lane: string | {
        /** (1–64 characters) */
        id: string;
      };
    } | {
      kind: "advance_card";
      /** The token. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
    } | {
      kind: "set_lane_capacity";
      /** The lane or step. */
      lane: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The limit, or null to remove it. */
      capacity: number | null;
    } | {
      kind: "set_card_lanes";
      /** The card. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The lanes, or null for any lane. */
      lanes: Array<string | {
        /** (1–64 characters) */
        id: string;
      }> | null;
    } | {
      kind: "set_card_points";
      /** The feature. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** Its points. (1 to 24) */
      points: number;
    } | {
      kind: "set_card_dependencies";
      /** The feature. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The features it depends on. An empty list with mode replace removes them all. (0–23 items) */
      dependsOn: Array<string | {
        /** (1–64 characters) */
        id: string;
      }>;
      /** replace (the default), add or remove. */
      mode?: "replace" | "add" | "remove";
    } | {
      kind: "set_outcome";
      /** The card. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The lane. */
      lane: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** What it says when the card is there. (1–160 characters) */
      whenPresent: string;
      /** What it says otherwise. (1–160 characters) */
      whenAbsent: string;
      /** The outcome’s name. Left out, it is “CARD in LANE”, and an outcome for that card and lane is replaced. (1–80 characters) */
      label?: string;
    } | {
      kind: "remove_outcome";
      /** The card. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The outcome. Left out, every outcome of the card goes. */
      outcome?: string | {
        /** (1–64 characters) */
        id: string;
      };
    } | {
      kind: "set_presentation_order";
      /** Every lane or step, once, in order. (2–5 items) */
      lanes: Array<string | {
        /** (1–64 characters) */
        id: string;
      }>;
    } | {
      kind: "present_lane";
      /** The lane or step. */
      lane: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** Present it just before this one. */
      before?: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** Present it just after this one. */
      after?: string | {
        /** (1–64 characters) */
        id: string;
      };
    } | {
      kind: "add_station";
      /** The step it follows. */
      from: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The new step’s name. (1–80 characters) */
      label: string;
      /** What it says when a token arrives. Left out, its name. (1–160 characters) */
      outcome?: string;
    } | {
      kind: "insert_station";
      /** The step it goes in front of. */
      before: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** Only the path from this step is taken over. */
      from?: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The new step’s name. (1–80 characters) */
      label: string;
      /** What it says when a token arrives. Left out, its name. (1–160 characters) */
      outcome?: string;
    } | {
      kind: "connect_stations";
      /** Where the path starts. */
      from: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** Where it leads. */
      to: string | {
        /** (1–64 characters) */
        id: string;
      };
    } | {
      kind: "disconnect_stations";
      /** Where the path starts. */
      from: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** Where it leads. */
      to: string | {
        /** (1–64 characters) */
        id: string;
      };
    } | {
      kind: "set_station_outcome";
      /** The step. */
      station: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** What it says. (1–160 characters) */
      outcome: string;
    } | {
      kind: "set_station_position";
      /** The step. */
      station: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** Column, 0 to 2. (0 to 2) */
      column: number;
      /** Row, 0 to 2. (0 to 2) */
      row: number;
    } | {
      kind: "set_station_image";
      /** The step. */
      station: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** {src, alt}: an HTTPS address and what the picture shows; or null. */
      image: {
        /** (1–2048 characters) */
        src: string;
        /** (1–240 characters) */
        alt: string;
      } | null;
    } | {
      kind: "set_station_image_alt";
      /** The step. */
      station: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** What the picture shows. (1–240 characters) */
      alt: string;
    } | {
      kind: "connect_cards";
      /** The card the line starts at. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The card it points to. */
      to: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** Words on the line. (1–200 characters) */
      label?: string;
    } | {
      kind: "disconnect_cards";
      /** One card. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The other card. */
      to: string | {
        /** (1–64 characters) */
        id: string;
      };
    } | {
      kind: "connect_note";
      /** The card. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The id of an ordinary note on the slate. (1–64 characters) */
      note: string;
      /** to_note (the default): the line points from the card to the note; from_note: from the note to the card. */
      direction?: "to_note" | "from_note";
      /** Words on the line. (1–200 characters) */
      label?: string;
    } | {
      kind: "disconnect_note";
      /** The card. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The id of the note. (1–64 characters) */
      note: string;
    } | {
      kind: "set_task";
      /** The task. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** Its days, 1 to 60. (1 to 60) */
      duration?: number;
      /** Days it waits, 0 or more. (0 to 120) */
      lag?: number;
    } | {
      kind: "link_tasks";
      /** The task that waits. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The task it waits on. */
      waitsOn: string | {
        /** (1–64 characters) */
        id: string;
      };
    } | {
      kind: "unlink_tasks";
      /** The task that waits. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The task it waits on. */
      waitsOn: string | {
        /** (1–64 characters) */
        id: string;
      };
    } | {
      kind: "set_launch_day";
      /** Launch day. (5 to 120) */
      day: number;
    } | {
      kind: "set_amount";
      /** The deal or line item. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** Whole currency units. (0 to 1000000000) */
      amount: number;
    } | {
      kind: "set_target";
      /** Whole currency units. (1 to 1000000000) */
      amount: number;
    } | {
      kind: "shift_budget";
      /** The team giving. */
      from: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The team receiving. */
      to: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** Whole currency units. (1 to 1000000000) */
      amount: number;
    } | {
      kind: "set_budget_total";
      /** The new total, in whole currency units. (1 to 1000000000) */
      amount: number;
      /** Which edge moves: end (the last team’s side, the default) or start (the first team’s). */
      edge?: "end" | "start";
    } | {
      kind: "add_rule";
      /** The rule, lanes by id or name. */
      rule: {
        kind: "capacity" | "path" | "gate" | "bin" | "deadline" | "overlap" | "snap" | "workdays" | "blackout" | "cascade" | "locked" | "nests" | "children" | "depth" | "rank" | "emptyDrop" | "quadrant" | "parent" | "contains" | "sameOwnerAs";
        severity?: "refuse" | "warn";
        where?: string | {
          /** (1–64 characters) */
          id: string;
        };
        /** (1 to 40) */
        max?: number;
        from?: string | {
          /** (1–64 characters) */
          id: string;
        };
        /** (1–4 items) */
        to?: Array<string | {
          /** (1–64 characters) */
          id: string;
        }>;
        noSkip?: true;
        into?: string | {
          /** (1–64 characters) */
          id: string;
        };
        /** (1–3 items) */
        needs?: string[];
        lane?: string | {
          /** (1–64 characters) */
          id: string;
        };
        at?: "launch" | "runway";
        /** (1 to 60) */
        floor?: number;
        unit?: "day" | "week";
        start?: string;
        end?: string;
        /** (1–40 characters) */
        label?: string;
        onConflict?: "push" | "stop";
        /** (1–6 items) */
        cards?: Array<string | {
          /** (1–64 characters) */
          id: string;
        }>;
        /** (1–24 characters) */
        role?: string;
        /** (1–4 items) */
        under?: string[];
        /** (at most 20 characters) */
        by?: string;
        drop?: "new-pile" | "unsorted";
        quadrant?: "do-now" | "plan" | "later" | "skip";
        /** (at most 24 characters) */
        not?: string;
        /** (at most 24 characters) */
        of?: string;
        /** (1 to 12) */
        atLeast?: number;
        mode?: "warn" | "ask" | "carry";
      };
    } | {
      kind: "set_rule";
      /** The rule id. (1–64 characters) */
      rule: string;
      /** On or off. */
      on?: boolean;
      /** refuse or warn. */
      severity?: "refuse" | "warn";
      /** A limit. (1 to 24) */
      max?: number;
      /** Where a path leads. (1–4 items) */
      to?: Array<string | {
        /** (1–64 characters) */
        id: string;
      }>;
      /** A runway floor, in months. (1 to 60) */
      floor?: number;
      /** A slip pushes the tasks that wait on it, or stops at them. */
      onConflict?: "push" | "stop";
      /** Snap to days or weeks. */
      unit?: "day" | "week";
      /** Nest board: the roles a role may sit under (words, such as opportunity). (1–4 items) */
      under?: Array<string | {
        /** (1–64 characters) */
        id: string;
      }>;
      /** Nest board: what piles rank by: count, sources, or a number field. (1–20 characters) */
      by?: string;
      /** Nest board: where a far drop goes. */
      drop?: "new-pile" | "unsorted";
      /** Goals & owners: what a change of team does to the cards under a card. */
      mode?: "warn" | "ask" | "carry";
    } | {
      kind: "remove_rule";
      /** The rule id. (1–64 characters) */
      rule: string;
    } | {
      kind: "set_plan_start";
      /** The new first day, as 2026-11-30. (10–10 characters) */
      start: string;
    } | {
      kind: "set_plan_weeks";
      /** Weeks, 13 to 104. (13 to 104) */
      weeks: number;
    } | {
      kind: "set_band_cost";
      /** The band, by id or name. (1–40 characters) */
      band: string;
      /** Whole currency units a month. (1 to 10000000) */
      monthly: number;
    } | {
      kind: "set_funding";
      /** Days from the first day. (0 to 728) */
      day: number;
    } | {
      kind: "nest_card";
      /** The card. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The card it goes under. */
      under?: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The area it goes to the top of. */
      lane?: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The sibling it goes before. Left out, last. */
      before?: string | {
        /** (1–64 characters) */
        id: string;
      };
    } | {
      kind: "start_pile";
      /** The card. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The pile’s name. Left out, “New pile”. (1–80 characters) */
      label?: string;
    } | {
      kind: "merge_cards";
      /** The card that goes. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The card it merges into. */
      into: string | {
        /** (1–64 characters) */
        id: string;
      };
    } | {
      kind: "set_role";
      /** The card. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** A word or two. (1–24 characters) */
      role: string;
    } | {
      kind: "set_source";
      /** The card. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** Who said it. (1–60 characters) */
      source: string;
    } | {
      kind: "add_field";
      /** Its name. (1–20 characters) */
      label: string;
      /** A money field’s sign. */
      currency?: "$" | "€" | "£";
      /** A yes/no field (contractor…): cards carry 1 for yes. */
      flag?: boolean;
    } | {
      kind: "set_field";
      /** The card. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The field, by id or name. (1–20 characters) */
      field: string;
      /** A whole number, or null. */
      value: number | null;
    } | {
      kind: "set_layout";
      /** clusters or tree. */
      layout: "clusters" | "tree";
    } | {
      kind: "score_card";
      /** The card. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The score across (effort). (0 to 10) */
      x: number;
      /** The score up (impact). (0 to 10) */
      y: number;
    } | {
      kind: "rename_field";
      /** The field, by id or name. (1–20 characters) */
      field: string;
      /** Its new name. (1–20 characters) */
      label: string;
    } | {
      kind: "add_owner";
      /** The team’s name. (1–30 characters) */
      label: string;
    } | {
      kind: "set_owner";
      /** The card. */
      card: string | {
        /** (1–64 characters) */
        id: string;
      };
      /** The team, by id or name. (1–30 characters) */
      owner: string;
      /** The cards under it that come along. (0–40 items) */
      carry?: Array<string | {
        /** (1–64 characters) */
        id: string;
      }>;
    }>;
    /** (at least 0) */
    expectedRevision: number;
    /** The board (slates.get boards[].id; main is the first). Required when the slate holds several boards. */
    boardId?: string;
  }>;
  [key: string]: unknown;
}

interface WorkshopLinePlan {
  /** (at least 1 characters) */
  message: string;
  /** (1–1 items) */
  operations: Array<{
    kind: "connect_workshop_card" | "disconnect_workshop_card";
    cardId: string;
    /** Another card of the workshop, or an ordinary note of the slate by its note ID. To disconnect, it can also be the id of one of the card's lines (workshop.lines[].id): the only way to name a line whose end is free on the canvas (toPoint). */
    toId: string;
    /** (at least 0) */
    expectedRevision: number;
    /** The board (slates.get boards[].id; main is the first). Required when the slate holds several boards. */
    boardId?: string;
  }>;
  [key: string]: unknown;
}

interface WorkshopMovePlan {
  /** (at least 1 characters) */
  message: string;
  /** (1–1 items) */
  operations: Array<{
    kind: "move_workshop_card";
    cardId: string;
    laneId: string;
    /** (at least 0) */
    expectedRevision: number;
    /** The board (slates.get boards[].id; main is the first). Required when the slate holds several boards. */
    boardId?: string;
  }>;
  [key: string]: unknown;
}

/** Put the workshop back as it was before one of your saved edits, only while nothing has changed since (otherwise 409 slate_changed with the board as it stands). */
interface WorkshopUndoPlan {
  /** (at least 1 characters) */
  message: string;
  /** (1–1 items) */
  operations: Array<{
    kind: "undo_workshop_edit";
    /** The receiptId a saved workshop edit of yours answered with. */
    receiptId: string;
    /** (at least 0) */
    expectedRevision: number;
    /** The board (slates.get boards[].id; main is the first). Required when the slate holds several boards. */
    boardId?: string;
  }>;
  [key: string]: unknown;
}
