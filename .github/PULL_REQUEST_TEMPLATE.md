<!--
Thanks for contributing! A few things that help this land quickly (CONTRIBUTING.md has more):
- The title is a Conventional Commit: feat(scope): ..., fix(scope): ..., docs: ...
  It becomes the commit subject and the changelog line.
- Rebase on main rather than merging main in.
- Security fixes go through a private advisory first (SECURITY.md), not a public pull request.
-->

## What and why

<!-- What changes, for whom, and why. Link the issue: "Fixes #123". -->

## How it was tested

<!-- The tests you ran (for example `npm run test:installer`), and what you checked by hand.
     Screenshots or a short clip for anything visible. -->

## Checklist

- [ ] The title follows Conventional Commits (`type(scope): summary`); a breaking change says so with `!` or a `BREAKING CHANGE:` footer.
- [ ] Tests for the changed code pass locally; new behavior has a test.
- [ ] Docs, READMEs or the `[Unreleased]` notes in the changelog are updated if people will notice the change.
- [ ] MIT code does not import from `enterprise/`.
- [ ] No keys, tokens, settings files or personal data are included.
