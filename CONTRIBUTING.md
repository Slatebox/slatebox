# Contributing to Slatebox

Hooray for your interest in contributing to Slatebox!

## Contents

- [Code of Conduct](#code-of-conduct)
- [Directory Structure](#directory-structure)
- [Development Setup](#development-setup)
- [Prerequisites](#prerequisites)
- [Run Slatebox Locally](#run-slatebox-locally)
- [Developing](#developing)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

This project and everyone participating in it are governed by the Code of
Conduct which can be found in the file [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
By participating, you are expected to uphold this code. Please report
unacceptable behavior through https://slatebox.com/contact/?topic=conduct.

## Directory Structure

Slatebox is structured in a yarn workspace mono-repo, despite not utilizing its full feature set. Below is the current directory structure:

 - [/web](/web) - The main app, with a Dockerfile and docker-compose file to run Slatebox in a container
 - [/web/app](/web/app) - This is the main Slatebox app, built with Meteor
 - [/desktop](/desktop) - Reserved for a future desktop app
 - [/packages](/packages) - Reserved for a future package integration
 - [/enterprise](/enterprise) - Enterprise features (outside agent connections): on Slatebox Cloud, and locked on a self-hosted install until a license key unlocks them. **Not MIT**: under the [Slatebox Enterprise License](enterprise/LICENSE). See [enterprise/README.md](enterprise/README.md)

### Licensing of contributions

Everything in this repository is MIT ([LICENSE.md](LICENSE.md)) except the `enterprise/` directory, which is under [enterprise/LICENSE](enterprise/LICENSE). A contribution to MIT code is made under MIT. A contribution to `enterprise/` is made under the terms in section 3 of enterprise/LICENSE. MIT code must work without `enterprise/`: never import from it. Enterprise code reaches the app only through the loader (`web/app/server/enterprise-loader.mjs`, `web/app/imports/api/client/enterprise-slots.mjs`), and only where enterprise code is unlocked: `settings.public.edition` is `"cloud"`, or a self-hosted install has a license key (`web/app/server/enterprise-license.mjs`).

## Development Setup

Want to help develop Slatebox? Set up external dependencies below:

### Prerequisites

* Node 22+: Use nvm - `nvm install 22.12.0`
* Install meteor globally: `npm install -g`
* Install mongosh (if you don't have mongo already): [https://www.mongodb.com/docs/mongodb-shell/install/](mongosh)

### Run Slatebox Locally

Once Meteor is installed, it's simple to start developing

1. Clone the repository
	```
	git clone https://github.com/slatebox/slatebox.git
	```

2. Go into slatebox root directory
	```
	cd slatebox/web/app
	```

3. Clone and build SlateboxJS, the canvas engine, next to this repository (`web/app/package.json` links `../../../slateboxjs-v2`):
	```
	(cd ../../.. && git clone https://github.com/Slatebox/slateboxjs-v2.git && cd slateboxjs-v2 && npm install && npm run build)
	```

4. Install all dependencies of all modules and link them together:
	```
	meteor npm install
	```

### Developing

To start slatebox, just run:

```
meteor npm run start
```

if there is a ns not found error, insert at least one slate object in mongo

```
meteor mongo

> db.slatePresentations.insert({ title: "Test Presentation" })
```

Once Slatebox is running, any changes to the code or directory will cause Meteor to hot reload the web app. Feel free to hack on Slatebox as its running live.

### Testing

You can run the e2e tests in the slatebox root app using the below command:

```
meteor npm run test
```

Tests are currently executed using the [testim development kit](https://help.testim.io/docs/index).

## Documentation

Documentation is accessible at https://docs.slatebox.com