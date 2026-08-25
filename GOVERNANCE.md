# Governance

This document describes who decides what in ata-validator, how those decisions
are made, and what you can expect if you depend on the project or contribute to
it. It describes the project as it actually is today, not as it might be later.

## Current state

ata-validator has one maintainer, [@mertcanaltin](https://github.com/mertcanaltin),
who wrote most of the code and reviews and merges everything. Five other people
have contributed. That is a real bus factor of one, and it is the single largest
risk in depending on this project. The section on becoming a maintainer below is
not a formality: growing that number is an open goal.

The project is MIT licensed. It is not under a foundation and has no corporate
owner or sponsor.

## Who decides

The maintainer decides. There is no committee and pretending otherwise would be
theatre at this size.

What that means in practice:

- Bug reports and pull requests are triaged and answered by the maintainer.
- Anything that changes behaviour a user could observe needs a test that fails
  before the change and passes after it.
- Disagreement about a technical call is settled by measurement where a
  measurement is possible, and by the specification where it is not. "It reads
  better" loses to "here are the numbers" and both lose to "the specification
  says this".

If the maintainer becomes unavailable for an extended period, the repository and
the npm packages stay where they are and nothing is transferred automatically.
Anyone depending on ata-validator in production should know that. A fork is
always permitted by the licence and would not be treated as hostile.

## What the project will and will not accept

The rules below are not style preferences. Each one exists because breaking it
has cost the project a real bug.

**A validator that wrongly accepts is worse than one that wrongly rejects.** A
wrong rejection produces a bug report. A wrong acceptance produces a security
incident somewhere else, months later. Any change that could make validation
more permissive is held to a higher standard than one that makes it stricter.

**Declining to compile is always allowed. Emitting nothing and calling it valid
is not.** The code generator has several entry points. When one of them cannot
represent a schema it must hand that schema to an engine that can. An empty
generated program returned as always-valid has been the cause of three separate
defects in this repository.

**Every number in the README, the docs and on the website is measured.** If a
change moves a published figure, the figure is remeasured and all copies of it
are updated in the same change. Estimates, rounded-up claims and figures carried
over from an older version are treated as defects.

**Compliance does not regress.** The official JSON Schema Test Suite runs across
three dialects, with code generation both enabled and blocked. A pull request
that lowers any of those scores is not merged, whatever else it improves.

Scope: ata-validator validates JSON against JSON Schema, and compiles schemas to
standalone modules. Features that belong in a framework adapter live in the
adapter repositories rather than here.

## Releases

Releases are cut by the maintainer. There is no fixed schedule; a release happens
when there is something worth shipping.

The process is in `CONTRIBUTING.md`. In outline: the version is bumped in
`package.json`, `lib/version.js` and `include/ata.h` together, CI has to be green
on every supported platform, and publishing a GitHub release triggers the
workflow that builds the native packages and publishes to npm through npm's
trusted publishing (OIDC). No long-lived npm tokens exist for this project.

Versioning follows semantic versioning. A change to what `validate()` answers for
a given schema and document is treated as breaking even when it makes the answer
more correct, and is called out in `CHANGELOG.md`.

## Becoming a maintainer

There is no fixed threshold, no application form and no probation period. The
practical path is that someone reviews other people's pull requests, or takes
ownership of an area and keeps it working over several releases. At that point
the maintainer offers commit access. Nobody has to ask for it.

If you have been contributing and want to take more responsibility, say so in an
issue. The answer is more likely to be yes than you expect.

## Security

Vulnerabilities go to the address in `SECURITY.md` and not to the public issue
tracker. The maintainer responds and coordinates disclosure.

## Code of conduct

`CODE_OF_CONDUCT.md` applies to every space the project uses. Reports go to the
maintainer at the address in that file.

## Changing this document

Through a pull request, like anything else.
