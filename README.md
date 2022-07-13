# Slatebox

![License](https://img.shields.io/badge/license-ELv2-green)
![Twitter Follow](https://img.shields.io/twitter/follow/slatebox?style=social)

[Slatebox](https://slatebox.com) is a free and open real-time visual collaboration canvas that allows remote participants to work together on a shared, infinite canvas. It is an alternative to proprietary apps like Miro.com.

Licensed with the Elastic License 2.0, Slatebox is free and open software than can be used for commercial purposes and installed on your own servers free of charge. Additionally, Slatebox Cloud is a SaaS service that makes it easy and affordable to get started.

![Slatebox Provides Free And Open Visual Collaboration For Remote Teams](https://d33wubrfki0l68.cloudfront.net/399f18bc5d70c92c04bd8af25dc061159dcd02b8/2e0ec/images/sb_mindmap.jpg)

## Prerequisites

Before you begin, ensure you have met the following requirements:

- You have installed the latest version of [Docker](https://docs.docker.com/engine/install/).
- You have a Linux machine running a modern OS.

## Installing Slatebox

To install Slatebox, follow the steps outlined here:

https://docs.slatebox.com/installation/install-with-docker/

## Using Slatebox

To use Slatebox, refer to the user guide here:

https://docs.slatebox.com/using-slatebox/

If you have any questions, please use the [discussion forum](https://community.slatebox.com).

## Contributing to Slatebox

Please take a look at the [Contributing Guidelines](CONTRIBUTING.md) to get started.

## Contact

You can reach me at tim@slatebox.com.

## Tech Stack

Slatebox is built with [Meteor](https://meteor.com) using [React](https://reactjs.org/) and [Material UI](https://mui.com/). Native to Meteor development is Mongo as the backend; Slatebox Cloud extends the real-time performance of Meteor by implementing [the redis oplog caching layer](https://github.com/cult-of-coders/redis-oplog), but this performance improvement is not baked into the Slatebox community edition.

[Slateboxjs](https://github.com/slatebox/slateboxjs) is the MIT-licensed diagramming library used.

## License

This project uses the following license: [ELv2](https://www.elastic.co/licensing/elastic-license).
