# Security policy

Jay answers support questions for Pons Family in public. A bug here can put users' funds at risk, so security reports get priority over everything else.

## Reporting a vulnerability

Please do not open a public issue for security problems.

- Use GitHub's private reporting: **Security** tab, then **Report a vulnerability**.
- Or email **contact@ponsfamily.com** with `jay security` in the subject.

Include what you found, how to reproduce it, and what an attacker could do with it. We aim to acknowledge reports within 2 business days and to share a fix plan within 7.

## What counts

In scope:

- A message that gets Jay to post a link, address, cashtag or tag its safety checks should have blocked
- A message that gets Jay to ask a user for a seed phrase, private key or password, or to give price or investment advice
- Prompt injection that makes Jay ignore its rules or leak its instructions
- Anything that makes Jay reply twice, reply to the wrong person, or post from dry-run mode
- Leaked credentials, unsafe logging of secrets, or dependency issues with a real impact

Out of scope:

- Findings in the Pons contracts. Report those through [ponsfamily.com](https://ponsfamily.com); the contracts live in [`ponsdotdev/ponsfamily`](https://github.com/ponsdotdev/ponsfamily).
- Rate limits or availability of the X API itself
- Social engineering of the team

## How Jay is built to limit damage

- Jay has no wallet and no private key. Chain access is read-only.
- Every reply passes fixed safety checks in `src/safety/guardrails.ts` before it can be posted.
- Replies are capped per hour, and anything uncertain is held for a person.
- Secrets come only from environment variables and are redacted in logs.

## Supported versions

Only the latest commit on `main` is supported. Fixes are not backported.
