# Governance

This document describes who decides what in ata-validator, how those decisions
are made, and what you can expect if you depend on the project or contribute to
it. It describes the project as it actually is today, not as it might be later.

## The people

ata-validator has been built by, in order of first contribution:

- [@mertcanaltin](https://github.com/mertcanaltin)
- [@SukeshP1995](https://github.com/SukeshP1995)
- [@lemire](https://github.com/lemire), whose work on replacing string
  comparisons with integer masks set the approach the hot paths still follow
- [@armagandalkiran](https://github.com/armagandalkiran)
- [@pnodet](https://github.com/pnodet)

Anyone whose patch lands here belongs on that list. If you contributed and are
missing from it, that is an oversight worth a pull request.

The related packages `fastify-ata`, `ata-vite` and `@ata-project/keywords` live
in the same organisation and follow this document.

The project is MIT licensed. It is not under a foundation and has no corporate
owner or sponsor.

## Bus factor

Commit access, review and the ability to publish a release currently rest with
one person. That is a structural limit rather than a preference, and it is the
largest risk in depending on this project: there is no second person who can
merge a security fix or cut a release today.

Say so plainly rather than discover it later. Two things follow from it. The
section on becoming a maintainer below is not a formality, and forking is
permitted by the licence and would not be treated as a hostile act.

## Who decides

Decisions are made by whoever holds commit access, which today is one person.
There is no committee, and inventing one on paper at this size would be
theatre.

What that means in practice:

- Bug reports and pull requests are triaged and answered here, not left to rot.
- Anything that changes behaviour a user could observe needs a test that fails
  before the change and passes after it.
- Disagreement about a technical call is settled by measurement where a
  measurement is possible, and by the specification where it is not. "It reads
  better" loses to "here are the numbers" and both lose to "the specification
  says this".

If the people with commit access become unavailable for an extended period, the
repository and the npm packages stay where they are and nothing is transferred
automatically. Anyone running ata-validator in production should plan for that
the way they would for any small dependency.

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

There is no fixed release schedule; a release happens when there is something
worth shipping.

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
ownership of an area and keeps it working over several releases. Commit access
is then offered. Nobody has to ask for it.

If you have been contributing and want to take more responsibility, say so in an
issue. The answer is more likely to be yes than you expect.

## Security

Vulnerabilities go to the address in `SECURITY.md` and not to the public issue
tracker. Disclosure is coordinated from there.

## Code of conduct

`CODE_OF_CONDUCT.md` applies to every space the project uses. Reports go to the
address in that file.

## Changing this document

Through a pull request, like anything else.
