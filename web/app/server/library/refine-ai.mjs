// The refine AI (QUEUE replaces this stub with the AI call). The contract it keeps:
//
//   refineWithAI({ item, board, message, history, principal }) → { reply, meta?, edits?, check?, ai? }
//
// The real one calls runAIAction({ feature: 'library-refine' }, …) with one forced tool,
// propose_library_refinement, on the connection settings.ai.use.library chooses (which falls back
// to use.chat, then use.default: server/methods/ai/connections.mjs), with built-in defaults under
// "library" in server/config/ai-defaults.json. `ai` is { feature: 'library-refine', ref, request, reply }
// for the event log: the connection's ref, never a key.
//
// Until then, anything the local grammar (refine.mjs) does not read is answered with a reply only:
// nothing changes and no AI is spent.
export async function refineWithAI() {
  return {
    reply: 'I can rename it ("rename it to …"), move it to a category ("put it in Decide") or change its one-line summary ("summary: …"). Edit the board itself on the canvas.',
  }
}
