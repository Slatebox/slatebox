// Agent settings both the server and the page read (settings.public.agents).
//   editDirectly  people may let one agent's edits save at once (agents.control), each one an
//                 undoable action. Off unless set to true; until then every agent edit is a suggestion.

export const editDirectlyEnabled = (settings) => settings?.public?.agents?.editDirectly === true
