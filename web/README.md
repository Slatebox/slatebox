# Slatebox web application

The Meteor application behind [app.slatebox.com](https://app.slatebox.com) (Slatebox Cloud) and self-hosted installations.

## Table of Contents

- [Overview](#overview)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Development](#development)
- [Deployment](#deployment)
- [Technologies](#technologies)

## Overview

The MIT-licensed app powers Slatebox Cloud and self-hosted installations. The repository's top-level `enterprise/` folder (Slatebox Cloud's outside-agent connections) is under the Slatebox Enterprise License instead, and self-hosted builds leave it out. Follow the [self-hosting guide](../self-host/README.md) to install the app, collaboration service and database.

## Project Structure

- `/app` - The main Meteor application
- `/Dockerfile` - Docker configuration for containerization
- `/docker-compose.yml` - Docker Compose configuration for local development

## Quick Start

To run the application locally:

1. Navigate to the `/web/app` directory

```bash
cd web/app
```

2. Install dependencies

The app uses SlateboxJS, the canvas engine, from a checkout of [Slatebox/slateboxjs](https://github.com/Slatebox/slateboxjs) next to this repository, in a folder named `slateboxjs-v2` (`web/app/package.json` links `../../../slateboxjs-v2`). Clone and build it once, then install the app:

```bash
# from the folder that holds this repository
git clone https://github.com/Slatebox/slateboxjs.git slateboxjs-v2
(cd slateboxjs-v2 && npm install && npm run build)

cd slatebox/web/app
meteor npm install
```

3. Create your local settings

```bash
cp settings.example.json settings.dev.json
```

`settings.example.json` lists every setting the app reads, with empty values and a `"//"` note per section. Fill in only the keys for the features you use (mail, picture search, icons, AI providers, calls); an empty value leaves that feature off. Settings files other than the example are git-ignored: never commit one with real keys. Anything under `public` reaches every browser, so only keys that are meant to be public belong there.

4. Start the development server

```bash
meteor npm run start
```

This command runs the application using development settings and also starts the Stripe webhook listener and Testim for testing.

## Development

The main application is built with Meteor and React. The `package.json` in the `/web/app` directory contains several useful scripts:

- `start` - Run the application with development settings
- `startMin` - Run a minified version with development settings
- `startProd` - Run with a local `settings.prod.json` (git-ignored)
- `visualize` - Analyze the bundle size

## Deployment

The application can be deployed using Docker and Kubernetes. The `/k3` manifests are templates: their `*_SECRET` and `DOCKER_CONFIG` values are placeholders filled from your own secret store at deploy time. A deployed app reads its settings from the `METEOR_SETTINGS` environment variable, never from a file in the image.

### Metering and top-ups

Slatebox is free and open source, except the `enterprise/` folder (on Slatebox Cloud; locked in a self-hosted image until an on-prem license unlocks it). On Slatebox Cloud (`metering.enabled` and `metering.proRequiredFrom: "now"` in settings) AI and calls on Slatebox's own providers come with Slatebox Pro, one optional personal subscription, whose monthly credits are sized by `metering.creditCostMicrosPerMonth` and counted per calendar month with the month Pro starts in prorated. For a team, Slatebox Business (paid per member, inside Cloud) is bought by a team owner or admin on the team page once the Stripe prices `payments.business.monthly` / `.yearly` are set; until then it is sold by talking to us. Amounts live only on [the pricing page](https://slatebox.com/plans/). Cloud takes no own keys: past the credits, or without Pro, a person uses a prepaid balance topped up through Stripe Checkout. Payments and the meter run only on a server whose enterprise license resolves to Slatebox Cloud (`server/cloud-lock.mjs`); anywhere else they stay off whatever the settings say. Own AI and call keys are a self-hosted feature (`public.env: "selfhost"`, `imports/api/common/own-keys.mjs`), where they are free. A self-hosted Slatebox has no meter, no Slatebox Pro and no balances: those exist only on Slatebox Cloud, and the self-hosting guides do not cover them. How it works, the settings document and the owner's switch-day steps: [`server/metering/README.md`](app/server/metering/README.md).

## Technologies

- [Meteor](https://meteor.com) - Full-stack JavaScript platform
- [React](https://reactjs.org/) - UI library
- [Material UI](https://mui.com/) - Component library
- [Stripe](https://stripe.com) - Top-up payments
- [MongoDB](https://mongodb.com) - Database (native to Meteor)
