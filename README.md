## Welcome to the Slatebox Repository!

**Slatebox: the free, open-source team canvas.** Mind maps, diagrams, project plans and presentations, drawn by your assistant and edited live with your team. An open-source alternative to whiteboard tools such as Miro. MIT licensed. The canvas is free. On Slatebox Cloud, AI comes with Slatebox Pro; a self-hosted Slatebox can use its own AI key. [slatebox.com](https://slatebox.com)

*Not affiliated with or endorsed by Miro. Miro is a trademark of its owner.*

Connect your assistant: add `https://app.slatebox.com/mcp` as a remote MCP server (custom connector). [Agents and MCP](https://docs.slatebox.com/developers/slateboxapi/mcp/) · [MCP package](packages/slatebox-mcp/README.md)

![Slatebox Provides Free And Open Visual Collaboration For Remote Teams](https://d33wubrfki0l68.cloudfront.net/399f18bc5d70c92c04bd8af25dc061159dcd02b8/2e0ec/images/sb_mindmap.jpg)

## Contents

- [MIT license and source access](#mit-license-and-source-access)
- [So...what is Slatebox?](#so-what-is-slatebox)
- [Is there a cloud hosted version?](#is-there-a-cloud-hosted-version)
- [Documentation](#documentation)
- [Discussion Forum](#discussion-forum)
- [What's the deal? Who built this?](#whats-the-deal-who-built-this)
- [Want to help development?](#want-to-help-development)
- [What's the tech stack?](#whats-the-tech-stack)
- [Indebted to open source](#indebted-to-open-source)

## MIT license and source access

SlateboxJS and the Slatebox app are MIT licensed and their source is public. Anyone can run the app, collaboration service and database on their own infrastructure. [License](LICENSE.md) · [Self-hosting guide](self-host/README.md) · [Local development](web/README.md#quick-start)

## So...what is Slatebox?

Slatebox isn't just one thing. Atop its visual canvas, you can run remote meetings (daily standups, kanban), run brainstorming and ideation workshops (root cause analysis, customer touchpoints, fishbone diagrams) with any of its templates, or you can simply create expressive concept drawing and mind mapping with your classmates or colleagues. Or use it as a solo design tool to mock up ideas with an intuitive drag-and-drop system.

## Is there a cloud hosted version?

Yup! [Slatebox Cloud](https://app.slatebox.com) is free. AI and calls on Slatebox Cloud come with Slatebox Pro ($5 a month or $50 a year, plus tax where applicable); top up at our cost plus 5% when you need more, with or without Pro. For a team, [talk to us about Slatebox Business](https://slatebox.com/contact/?topic=business) ($6 per person a month or $60 a year).

For an installation on your infrastructure, follow the [self-hosting guide](self-host/README.md).

## Documentation

[Slatebox documentation is available here for all your questions](https://docs.slatebox.com).

## Discussion Forum?

Yep, we have a great community -- [join us here](https://community.slatebox.com) for a simple way to ask questions and engage.

## What's the deal? Who built this?

Slatebox is built by Slatebox LLC. There's a lot of backstory to this project, but basically it's been a labor of love over many years. If you're interested, check out the [blog](https://blog.slatebox.com) to get all the juicy details.

## Want to help development?

Please do. Visit the [Contributing Guidelines](CONTRIBUTING.md) to get started.

## What's the tech stack?

Slatebox is built with [Meteor](https://meteor.com) using [React](https://reactjs.org/) and [Material UI](https://mui.com/). Native to Meteor development is Mongo as the backend; Slatebox Cloud extends the real-time performance of Meteor by implementing [the redis oplog caching layer](https://github.com/cult-of-coders/redis-oplog).

## Indebted to open source

Slatebox uses Meteor, React, MongoDB and SVG.js. We thank the maintainers and contributors who make this project possible.
