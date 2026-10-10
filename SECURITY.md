# Security Policy

## Reporting a Vulnerability

If you find a security vulnerability in ata-validator, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, report it privately through GitHub (Security tab, "Report a vulnerability") or email mertgold60@gmail.com with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact

We will respond within 48 hours and work with you on a fix before any public disclosure.

## Scope

Security issues we care about:

- ReDoS in pattern validation for patterns without backreferences or lookaround (see below)
- Buffer overflows or memory safety issues in the C++ layer
- Code injection through schema compilation (`new Function()` paths)
- Prototype pollution through validation or coercion

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest minor release | Yes |
| Older releases | No, upgrade to the latest |

Fixes ship in a new patch or minor release. Every 1.x release is compatible
with the one before it, so moving to the latest minor to get a fix does not
mean changing your code. A change that would break that waits for 2.0.

What a report can expect:

- An answer within 48 hours.
- For a vulnerability that lets crafted input or a crafted schema run code,
  pollute prototypes, crash the process or make validation accept what it
  should reject: a fixed release within 7 days of confirming it.
- A published GitHub security advisory for every fixed vulnerability, naming
  the affected versions and the release that fixes it.

The project has one maintainer (see GOVERNANCE.md). These are commitments one
person can keep, and they are stated so you can hold the project to them.

## ReDoS

Patterns run on ata's own regular expression engine, which matches in linear time. The platform RegExp takes a pattern only when it is shown to run in linear time there too. A pattern the linear engine cannot represent, one with a backreference or a lookaround, runs on the platform RegExp as written, which can backtrack: if your schemas come from untrusted sources, keep those constructs out of them. If you find a slow pattern that uses neither, please report it.
