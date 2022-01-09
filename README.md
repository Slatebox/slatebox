## Welcome to the Slatebox Repository!

[Slatebox](https://slatebox.com) is a fair-code licensed, free and open visual collaboration canvas that is an alternative to proprietary apps like Miro.com.

![Slatebox Provides Free And Open Visual Collaboration For Remote Teams](https://d33wubrfki0l68.cloudfront.net/399f18bc5d70c92c04bd8af25dc061159dcd02b8/2e0ec/images/sb_mindmap.jpg)

## Contents

- [Licensed with ELv2](#licensed-with-elv2)
- [So...what is Slatebox?](#so-what-is-slatebox)
- [Is there a cloud hosted version?](#is-there-a-cloud-hosted-version)
- [Documentation](#documentation)
- [Discussion Forum](#discussion-forum)
- [What's the deal? Who built this?](#whats-the-deal-who-built-this)
- [Want to help development?](#want-to-help-development)
- [What's the tech stack?](#whats-the-tech-stack)
- [Indebted to open source](#indebted-to-open-source)

## Licensed with ELv2

Licensed with Elastic License v2, Slatebox is a fair-code licensed product that allows all personal and commercial endevours with the exception of [the three limitations listed in the ELv2](https://www.elastic.co/licensing/elastic-license). Basically, you're not allowed to pull an AWS and simply resell Slatebox as a service. Anything else? It's bloodly likely. Host Slatebox on your own servers, extend it, use it, adopt it, contribute back (or don't), and just generally love it as a powerful and free alternative to other proprietary remote tools. Do you hear me? YOU MUST LOVE IT. If you have any questions on the license, please reach out to tim@slatebox.com.

## So...what is Slatebox?

Slatebox isn't just one thing. Atop its visual canvas, you can run remote meetings (daily standups, kanban), run brainstorming and ideation workshops (root cause analysis, customer touchpoints, fishbone diagrams) with any of its templates, or you can simply create expressive concept drawing and mind mapping with your classmates or colleagues. Or use it a a solo design tool to mock up ideas with an intuitive drag-and-drop system.

## Is there a cloud hosted version?

Yup! If you don't want to deal with the hassle of installing and maintaining Slatebox on prem, [Slatebox Cloud](https://app.slatebox.com) is a simple, light, and affordable way to start using Slatebox immediately. The forever free plans means you'll always have a lightweight version available instantly -- invite unlimited users and start collaborating today. 

...Otherwise, if you want to run this on your own server, just follow the installation steps in the [docs](https://docs.slatebox.com)! It's a snap, really.

## Documentation

[Slatebox documentation is available here for all your questions](https://docs.slatebox.com).

## Discussion Forum?

Yep, we have a great community -- [join us here](https://community.slatebox.com) for a simple way to ask questions and engage.

## What's the deal? Who built this?

My name is [Tim Heckel](https://github.com/TimHeckel), and I'm Slatebox's creator. There's a lot of backstory to this project, but basically it's been a labor of love over many years. If you're interested, check out the [blog](https://blog.slatbox.com) to get all the juicy details.

## Want to help development?

Please do. Visit the [Contributing Guidelines](CONTRIBUTING.md) to get started.

## What's the tech stack?

Slatebox is built with [Meteor](https://meteor.com) using [React](https://reactjs.org/) and [Material UI](https://mui.com/). Native to Meteor development is Mongo as the backend; Slatebox Cloud extends the real-time performance of Meteor by implementing [the redis oplog caching layer](https://github.com/cult-of-coders/redis-oplog).

## Indebted to open source

Slatebox relies on so many of the above open source toosl, notably Meteor, which has always been a lovely platform and dear to me for many years. In the spirit of sustainability, Slatebox is ELv2 licensed with the hope that ensuring long-term commercial success is balanced with the open source spirit of free and open software.