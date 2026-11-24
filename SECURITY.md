# Security

## Reporting a vulnerability

Report a vulnerability privately, through GitHub's private vulnerability reporting:
<https://github.com/matapao/vindu/security/advisories/new>. Please do not open a public issue, pull request or
discussion about it.

Say what is affected (a version of `@matapao/vindu`, or a commit), what an attacker can do, and how to reproduce it. A
small page, server or test that shows it is the most useful. The report stays private between you and the maintainers
until a fix is released; then the advisory is published, crediting you if you want that.

## Supported versions

Fixes go into the latest release of `@matapao/vindu` on npm. While the version is 0.x, older releases are not patched:
update to the latest.

## Scope

In scope is what this package does itself: the UI sessions, the MCP provider and its endpoints, the page host, and the
renderer, in a browser or in Electron. That includes what it lets a model's pages, tools and results reach, and the
checks it promises (what it refuses, bounds and asks the person about).

The host that runs the provider owns harness startup, credentials, model selection, execution policy, device
permissions and cancellation. A weakness in those choices is the host's to fix, unless the SDK documents a behaviour
that leads a host into it.

## Known advisories

Advisories in dependencies that are accepted, each with its reason and an expiry, are listed in
[osv-scanner.toml](osv-scanner.toml). The daily security run fails on any other.
