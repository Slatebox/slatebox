<p align="center">
  <a href="https://slatebox.com"><img src="https://slatebox.com/assets/slatebox.svg" alt="Slatebox" width="72" height="66"></a>
</p>

<h1 align="center">Slatebox</h1>

<div align="center">

**Slatebox is the free, open-source visual intelligence platform for your team and agents.**<br>
People and agents on one live canvas: diagrams, mind maps, smart boards, plans and presentations that compose themselves. MIT licensed. An open-source alternative to whiteboard tools such as Miro.

<sub>*Not affiliated with or endorsed by Miro. Miro is a trademark of its owner.*</sub>

</div>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-2f5d50"></a>
  <a href="https://www.npmjs.com/package/slatebox"><img alt="npm: slatebox" src="https://img.shields.io/npm/v/slatebox?label=npm%20slatebox&color=b5562a"></a>
  <a href="https://www.npmjs.com/package/slatebox-mcp"><img alt="npm: slatebox-mcp" src="https://img.shields.io/npm/v/slatebox-mcp?label=npm%20slatebox-mcp&color=b5562a"></a>
  <a href="https://registry.modelcontextprotocol.io/v0/servers?search=com.slatebox/slatebox"><img alt="MCP Registry: com.slatebox/slatebox" src="https://img.shields.io/badge/MCP%20Registry-com.slatebox%2Fslatebox-2f5d50"></a>
</p>

<p align="center">
  <a href="https://app.slatebox.com"><strong>Open the app</strong></a> ·
  <a href="https://slatebox.com">Website</a> ·
  <a href="https://docs.slatebox.com">Docs</a> ·
  <a href="https://support.slatebox.com">Support</a> ·
  <a href="https://slatebox.com/plans/">Pricing</a>
</p>

<p align="center">
  <a href="https://slatebox.com"><img src="https://slatebox.com/assets/share/home.jpg" alt="The Slatebox home page: a launch slate with a flowchart, a latency chart, a pull request card and agents working beside the team as named cursors." width="900"></a>
</p>

## What is Slatebox?

Slatebox is a free, open-source canvas where your team and your agents draw, sort and present what they know, together and live. It is not only "make me a diagram": every note, line, frame and board on a slate is structure the canvas understands, so a person and an agent can work on the same board at the same time and the board's rules hold for both.

- **People and agents on one slate.** Share a link and people join with named cursors; guests don't need an account. Claude, ChatGPT, Cursor, a coding agent or your own script connects over MCP, the command line or the API and shows up as a named cursor with its plan. An agent's edits are checked as if you had made them, and removing anything waits for a person's yes.
- **Diagrams, flowcharts and mind maps.** Type steps with arrows and they are drawn as connected notes, no AI needed. Or describe what you want and Slatebox's agent drafts it as a preview you keep or discard.
- **Smart boards and Gantt plans.** Launch plans, pipelines, budgets, hiring plans and retros made of notes. A move that breaks a board's rules is refused in words, for people and agents alike, and you change a rule by saying so.
- **A shared Library.** Build your own smart component by chatting with Slatebox, or branch someone else's. Every submission is reviewed before it reaches the public library.
- **Presentations that compose themselves.** Press Present and Slatebox plans the walkthrough: title cards, spotlights, reveals and camera moves across the canvas, in one of eight styles.
- **Mermaid in, Mermaid out.** Paste Mermaid and get an editable slate; export any slate back as Mermaid.

## Get started

### Use Slatebox Cloud

Open [app.slatebox.com](https://app.slatebox.com) and start a slate. Slatebox Cloud is free for individuals and companies alike. The canvas is free. On Slatebox Cloud, AI comes with Slatebox Pro; a self-hosted Slatebox can use its own AI key. Slatebox Pro and balances exist only on Slatebox Cloud. The details are on the [pricing page](https://slatebox.com/plans/).

### Connect your agent

Add **`https://app.slatebox.com/mcp`** as a remote MCP server (a custom connector) in Claude, ChatGPT, Cursor or any MCP client. It signs you in to Slatebox and asks which permissions to give it. Then ask it for a mind map.

To run the MCP server on your own machine instead, create a token in **Profile → Developer access** and start it with npx:

```json
{
  "mcpServers": {
    "slatebox": {
      "command": "npx",
      "args": ["-y", "slatebox-mcp"],
      "env": { "SLATEBOX_API_TOKEN": "<your token>" }
    }
  }
}
```

Add `"SLATEBOX_BASE_URL": "https://boards.example.com"` to point it at your own Slatebox, which serves the same endpoint at `/mcp`. Read about [`exec`, the typed tools and the safety rules](packages/slatebox-mcp/README.md), or the [agent setup guide](https://docs.slatebox.com/developers/slateboxapi/mcp/).

### Run your own Slatebox in one command

```sh
npx slatebox install
```

One container is a complete Slatebox: the app, the live collaboration relay and MongoDB, with Keycloak for single sign-on included and off until you turn it on. The installer asks a few short questions, shows a plan of everything it will do, and runs Slatebox with plain `docker run` (no Docker Compose) at a free `https://<name>.slatebox.team` address, on your own domain, or on this computer only. It can also install on a Linux server over SSH or on Kubernetes. `npx slatebox --dry-run` asks the same questions and prints the plan without changing anything. You need Node.js 22.13 or newer and Docker.

Prefer Docker directly?

```sh
docker run -d --name slatebox -p 7070:7070 -v slatebox-data:/data ghcr.io/slatebox/slatebox
docker exec slatebox slatebox setup-link   # one-time link to create the first admin
```

A self-hosted Slatebox brings its own AI: connect any model you like, or none. See the [installer](packages/slatebox/README.md), the [self-hosting guide](self-host/README.md) and the [operator docs](https://docs.slatebox.com/installation/install-with-docker/).

### Develop locally

The app is a [Meteor](https://www.meteor.com) 3 and React application in [`web/app`](web/app). It uses the SlateboxJS engine from a checkout next to this repository:

```sh
git clone https://github.com/Slatebox/slatebox.git
git clone https://github.com/Slatebox/slateboxjs.git slateboxjs-v2
(cd slateboxjs-v2 && npm install && npm run build)

cd slatebox/web/app
meteor npm install
cp settings.example.json settings.dev.json   # fill in only the features you use
meteor run --settings settings.dev.json
```

Details are in [web/README.md](web/README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## The engine: SlateboxJS

The canvas is [SlateboxJS](https://github.com/Slatebox/slateboxjs), an MIT-licensed JavaScript library for mind maps, diagrams and concept drawing (`npm install slateboxjs`). Build it into your own app with the [SlateboxJS docs](https://docs.slatebox.com/developers/javascriptlibrary/).

## What's in this repository

| Path | What it is |
| --- | --- |
| [`web/app`](web/app) | The Slatebox app behind Slatebox Cloud and every self-hosted install |
| [`packages/slatebox`](packages/slatebox) | `npx slatebox`: the installer and the `slatebox` command |
| [`packages/slatebox-mcp`](packages/slatebox-mcp) | The MCP server and CLI for agents (`slatebox-mcp`) |
| [`packages/create-slatebox`](packages/create-slatebox) | `npm create slatebox`, the same as `npx slatebox install` |
| [`self-host`](self-host) | The one-container image and its guide |
| [`enterprise`](enterprise) | Outside-agent connections (not MIT, see [License](#license)) |
| [`docs`](docs) | Technical notes on the app |

## Community and support

- **Questions and ideas:** [support.slatebox.com](https://support.slatebox.com), which runs on [GitHub Discussions](https://github.com/Slatebox/slatebox/discussions).
- **Bugs:** [open an issue](https://github.com/Slatebox/slatebox/issues/new/choose).
- **Security problems:** please don't post them in public; follow [SECURITY.md](SECURITY.md).
- **Contributing:** start with [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Slatebox is [MIT licensed](LICENSE), and so is the [SlateboxJS](https://github.com/Slatebox/slateboxjs) engine. The one exception is the [`enterprise/`](enterprise/README.md) directory, which holds the connections to outside agents (inviting an outside MCP server onto a slate, and connectors). Everything in `enterprise/` is under the source-available [Slatebox Enterprise License](enterprise/LICENSE): you may read, change and test it, but running it in production needs an agreement with Slatebox LLC. Third-party components keep their own licenses. See [LICENSING.md](LICENSING.md).

Slatebox's own MCP server, command line and API, and single sign-on with the bundled Keycloak, are MIT and work on every install.

---

<p align="center">
  Free and collaborative since 2009. Open source since 2012.<br>
  Built by Slatebox LLC and Slatebox contributors.
</p>
