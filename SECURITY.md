# Security policy

## Reporting a vulnerability

Please report security problems privately. Do not open a public issue, discussion or pull request
for them.

- **Preferred:** a private report through GitHub:
  [Report a vulnerability](https://github.com/Slatebox/slatebox/security/advisories/new). Only the
  maintainers see it, and we can work on the fix with you in a private fork.
- **Or:** the contact form at https://slatebox.com/contact, starting the message with "Security".

Say what you found, how to reproduce it, and what it lets someone do. This covers Slatebox Cloud
(app.slatebox.com), the self-host image, the `slatebox` installer and CLI, the MCP server
(`https://app.slatebox.com/mcp` and the `slatebox-mcp` package) and the API.

## What happens next

- We aim to acknowledge a report within 3 business days and to tell you within 10 business days
  whether we can reproduce it and how we plan to fix it.
- We keep you posted while we fix it, and agree on a disclosure date with you. We ask for up to 90
  days before details are made public.
- Fixes ship as new releases (see [Supported versions](#supported-versions)). We publish a GitHub
  security advisory, request a CVE where one applies, and credit you unless you would rather we
  didn't.

## Supported versions

Security fixes go into the newest release of each artifact. Upgrade to get them.

| Artifact | Supported | How to upgrade |
| --- | --- | --- |
| Slatebox Cloud (app.slatebox.com) | The deployed version | Nothing to do |
| Self-host image `ghcr.io/slatebox/slatebox` | The newest published image tag (the newest `vX.Y.Z` release that has an image; `npx slatebox status` shows yours) | Admin › Updates, `npx slatebox upgrade`, or pull the new tag |
| `slatebox` installer and CLI (npm) | The latest version | `npx slatebox@latest` |
| `slatebox-mcp` (npm) | The latest version | `npm install -g slatebox-mcp@latest` |
| Older releases | Not supported | |

The canvas engine, SlateboxJS, is in [Slatebox/slateboxjs](https://github.com/Slatebox/slateboxjs);
report engine problems the same way, here or there.

## Testing rules

Only test against your own account and slates, or a Slatebox you run yourself. Do not read or
change other people's data, and do not degrade the service for others (no denial-of-service tests,
no spam, no social engineering of staff or users). Research done in good faith within these rules
is welcome, and we will not pursue it.
