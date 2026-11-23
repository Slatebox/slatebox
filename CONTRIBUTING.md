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