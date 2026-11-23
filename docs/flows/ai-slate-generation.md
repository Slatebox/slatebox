# AI Slate Creation Interaction Flow

[< Back to Documentation Home](../README.md)

This document outlines the process flow when a user initiates the creation of a Slate diagram via the AI assistant within the application, based on code analysis. It complements the visual representation in [AI Process Flow Diagram](../diagrams/AI_process_flow-mermaid.md).

## 1. Client-Side: Initiation and Intention Determination

1.  **Welcome & Initial Input (`Chat.jsx`):**
    - The `Chat.jsx` component mounts and displays an initial welcome message.
    - If the user provides an initial prompt (or one is carried over), `Chat.jsx` calls the `openai.welcome` Meteor method upon loading (`useEffect` hook) to determine the user's intention immediately.
    - If no initial prompt exists, `Chat.jsx` waits for the user to send their first message.
2.  **First Message / Intention Request (`Chat.jsx` -> `openai.welcome`):**
    - When the user sends their first message in a new AI session (`!localAIContext.intention`), the `postMessage` function in `Chat.jsx` calls the `openai.welcome` Meteor method.
    - The user's message content, current `slateShareId`, and any `templateId` are sent.
3.  **Intention Processing (`openai.js` - Welcome Flow):**
    - The `openai.welcome` method (defined in `web/app/server/methods/openai.js`) receives the request.
    - It uses an AI call (via the imported `req` function from `web/app/server/methods/ai/req.js`) to analyze the user's message and determine the appropriate `ChatIntention` (fetched from the `ChatIntentions` collection) and potentially extract initial parameters or identify a specific template.
    - It responds to `Chat.jsx` with the identified `intention` object, extracted parameters (`intentionItems`), and potentially a `slateTemplateId` or `slateAid` (AI conversation ID).
4.  **Intention Handling (`Chat.jsx` -> `initAIConversation.js`):**
    - The `handleWelcome` function in `Chat.jsx` receives the response from `openai.welcome`.
    - If an `intention` is identified:
      - It calls `initAIConversation` (`web/app/imports/api/common/initAIConversation.js`) passing the `intention` and the extracted `intentionItems` (user input/parameters collected into the `result` object).
5.  **Context Preparation (`initAIConversation.js`):**
    - `initAIConversation` selects the appropriate AI persona/prompts (`aiDecision.prompts`) based on the `intention` and the user `result` object.
    - It processes the prompts, replacing placeholders:
      - **Dynamic (`{{key}}`):** Iterates through keys in the `result` object (derived from the intention's `gather.items` definition) and replaces `{{key}}` with the corresponding `result[key]` value.
      - **Instructions (`{{instructions}}`):** Replaced by `result.instructions` or `aiDecision.defaultInstructions`.
      - **Technical Instructions (`{{technicalInstructions}}`):** Replaced by `result.technicalInstructions` or `aiDecision.defaultTechnicalInstructions`.
      - **Color (`{{baseColor}}`):** Replaced by `result.baseColor`.
      - **Template Name (`{{templateName}}`):** Replaced by `slate.options.templateName` (if `slate.options.basedOnTemplate` is true).
      - **Template Prompt (`{{templatePrompt}}`):** Replaced by a constructed string including category count, names, and `slate.options.templatePrompt` (if `slate.options.basedOnTemplate` is true).
      - **Items (`{{items}}`):** Replaced within the `intention.slateName` definition by a truncated primary value derived from `result` fields marked `isPrimary`.
    - Prompts are only included in the final `aiPrompts` array if all placeholders within them have been successfully replaced.
    - It directly modifies the client-side `slate` instance's state (e.g., sets name, layout, theme via `slate.collab.exe`).
    - It returns the prepared `entireAIContext` object, containing the final system prompts, user prompts (`aiPrompts`), and AI settings.
6.  **Store AI Context (`Chat.jsx`):**
    - `Chat.jsx` receives the `entireAIContext` from `initAIConversation` and stores it in its state (`currentAIContext`), marking the conversation as active.

## 2. Client-Server Handshake: Generating the Slate

1.  **Subsequent Messages (`Chat.jsx` -> `openai.chat`):**
    - Once the `currentAIContext` is set (conversation is active), any further user messages sent via `postMessage` in `Chat.jsx` now call the `openai.chat` Meteor method.
2.  **Call AI Method (`openai.js` - Chat Flow):**
    - The `openai.chat` method (defined in `web/app/server/methods/openai.js`) receives the user's message and the full `currentAIContext`.
    - It retrieves the conversation history associated with the `aid` from the `AIContent` collection.
    - It appends the new user message to the history.
    - It calls the `req` function (`web/app/server/methods/ai/req.js`) with the complete prompt history, system message, and AI configuration (engine, functions/tools).

## 3. Server-Side: AI Interaction and Slate Data Generation

1.  **External AI Request (`req.js`):**
    - The `req` function formats the request payload for the specific AI service (OpenAI or Anthropic) based on the configured `engine`.
    - It sends the request via HTTPS (`node-fetch`).
    - It handles API errors and performs retries if the response is not valid JSON, adding error messages to the prompt history for the AI to correct itself.
    - It returns the validated, parsed JSON response object to the calling function (in `openai.js`).
2.  **Response Processing (`processConversation.js`):**
    - The `openai.chat` method receives the validated response object from `req.js` and calls `processConversation` (`web/app/server/methods/ai/processConversation.js`).
    - `processConversation` parses the structured data (notes, categories, deletions) from the AI response.
    - It performs structural validation (e.g., checks IDs, word counts).
    - If validation fails, it adds error details to the prompt history and triggers `req.js` again (via the internal `kickoff` function) to ask the AI for corrections.
    - If validation succeeds:
      - It handles deletions by marking corresponding entries in `AIContent` as `deleted: true`.
      - It processes each note and category description from the response.
      - It calls its internal `createNode` helper for each note/category.
3.  **Staging Slate Data (`processConversation.js` -> `createNode`):**
    - The `createNode` helper function:
      - Formats the note/category data.
      - Fetches icons/shapes (`getNounPaths`) or images (`images.searchGoogleImages`) if requested by the AI.
      - Upserts the structured note/category data into the `AIContent` MongoDB collection, linking it to the `aid` (conversation ID).
4.  **Save Final AI Response (`processConversation.js`):**
    - Saves the final, successful AI assistant message/response into `AIContent`.

## 4. Client-Side: Rendering the Slate via Reactive Listener

1.  **AI Listener Component (`AIContentListener.jsx`):**
    - This React component (`web/app/imports/ui/components/ai/AIContentListener.jsx`) is mounted in the application UI (likely alongside the main canvas component).
    - It uses the Jotai atom `createSlateWithAIContent` to get the current AI conversation ID (`currentAIContext.aid`).
2.  **Data Subscription & Observation (`AIContentListener.jsx`):**
    - It uses `useTracker` to establish a reactive Meteor subscription to the `AIContent` collection, filtered by the current `aid`.
    - Within the tracker, it uses `AIContent.find(...).observe({ added(doc) {...} })`.
3.  **Handling New AI Content (`added(doc)` in `AIContentListener.jsx`):**
    - When the server (`processConversation.js`) inserts a new document (`doc`) into `AIContent` for the current `aid`, the `added` callback fires reactively on the client.
    - **Node/Category Creation/Update:** If the `doc.role` is `node` and `doc.type` is `conversation`:
      - It calls the imported `createAIConversationNode` function (`web/app/imports/api/common/ai.js`).
      - `createAIConversationNode` checks if a node/category with the `doc.id` already exists on the `slate` instance.
      - If it exists, it issues update commands (e.g., `onNodeTextChanged`, `onNodeMovedResized`) via `slate.collab.exe`.
      - If it doesn't exist, it issues an `onNodeAdded` command via `slate.collab.exe`.
      - It also handles creating connections based on `parentCategoryIds` via `onConnectionAdded`.
    - **Deletions:** If `doc.deleted` is true, it issues an `onNodeDeleted` command via `slate.collab.exe`.
    - **Other Roles/Types:** It handles other roles (like `coordinator`) and types (like `template`, `scratch`) by calling appropriate functions (`createAISticky`, `updateAINode`).
    - **Layout:** Triggers layout adjustments (`redoLayout`) after processing nodes.
4.  **Canvas Updates:** The `slate.collab.exe` commands dispatched by `createAIConversationNode` (and other helpers) update the state of the shared Slatebox canvas instance, causing the diagram elements to be rendered or modified on the user's screen.
5.  **Chat Updates (`Chat.jsx`):**
    - Separately, `Chat.jsx` subscribes to the `Messages` collection and reactively displays new chat messages added by the server (`processConversation.js`) in the chat UI.
