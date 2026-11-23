# Contributing to Documentation

[< Back to Documentation Home](./README.md)

This document outlines the process and guidelines for generating and maintaining application documentation using the AI coding assistant.

## Core Principles

1.  **Research First, Document Second:** The AI assistant **must** be explicitly prompted to investigate and analyze the relevant codebase _before_ generating any documentation content. Documentation should strictly reflect the findings from the code. Avoid assumptions.
2.  **Modularity:** Break documentation into logical units (features, components, flows, concepts) in separate Markdown files.
3.  **Navigability:** Use relative Markdown links (`[Link Text](../relative/path/to/file.md)`) to connect related documents, creating a browsable structure.
4.  **Consistency:** Adhere to the defined file naming, structure, and prompting conventions.

## Directory Structure

Organize documentation files within the `docs/` directory using the following structure:

```
docs/
├── README.md             # Main entry point, table of contents
├── CONTRIBUTING_DOCS.md  # This file
├── architecture/         # High-level concepts, patterns, decisions
├── components/           # Documentation for specific UI/backend components
├── features/             # End-to-end documentation for user-facing features
├── flows/                # Detailed walkthroughs of specific processes/data flows
├── diagrams/             # Mermaid diagrams (or other visuals)
└── ...                   # Other categories as needed
```

## File Naming Conventions

Use descriptive, kebab-case names for files (e.g., `user-authentication.md`, `ai-slate-generation.md`).

## README.md Guidelines

- Keep the main `docs/README.md` concise, acting as a high-level table of contents.
- Link to major sections or specific key documents from the README.
- Avoid overly detailed descriptions in the README; place details in the specific documentation files.

## Standard Prompting Template

When requesting documentation generation or updates, use the following structure in your prompt to the AI assistant:

```
Goal: [Clearly state the documentation objective. e.g., "Document the server-side logic for processing widget orders"]

Target File: [Specify the relative path to the file. e.g., "docs/features/widget-ordering.md". Indicate if it's a new file or an update to an existing one.]

Key Areas of Focus: [List the specific aspects to cover. e.g., "Input validation, database interactions, external API calls, error handling"]

Code Investigation Targets: [**Crucial Step** - List specific files, directories, function names, or class names the AI must research *first*. e.g., "web/app/server/methods/widgets.js (processOrder function), web/app/lib/externalApi.js"]

Expected Output Format: [Describe the desired structure or content elements. e.g., "Create sections for 'Validation', 'Database Updates', 'API Interaction'. Include a sequence diagram if the flow is complex."]

Additional Context: [Optional: Provide any other relevant information or constraints.]
```

## Linking Strategy

- Use relative Markdown links to connect documents.
- Link from higher-level documents (like `README.md` or feature overviews) to more detailed ones.
- Link between related concepts (e.g., a feature doc might link to the specific components it uses).
- **Navigation Link:** Start each documentation file (immediately after the main `#` title) with a link back to the main index: `[< Back to Documentation Home](../path/to/README.md)` (adjust relative path as needed).

## Diagram Guidelines

- Use diagrams (especially Mermaid) to clarify complex flows or structures.
- Store diagram source files (e.g., `.md` files for Mermaid) in the `docs/diagrams/` directory for organization.
- Embed or link diagrams directly within the relevant documentation files (e.g., embed a Mermaid diagram within `docs/flows/some-flow.md` or link to `../diagrams/some-flow-diagram.md` from within it). Avoid listing diagrams separately in the main README.
- **Navigation Backlink:** Add a visible Markdown link at the very top of the diagram source file (before the Mermaid code block) linking back to the primary documentation file that uses it (e.g., `[< Back to Parent Document](../path/to/parent.md)`).
- Reference diagrams from the main documentation files using relative links or embed them if the Markdown flavor supports it (embedding Mermaid directly is often preferred).
- Ensure diagrams are kept up-to-date with the code and documentation.
- Add HTML comments below the visible backlink indicating the parent document and the documentation home (e.g., `<!-- Parent Document: ../flows/flow-name.md -->`).
