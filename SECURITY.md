# Security policy

## Reporting a vulnerability

Please don't report security issues in public issues, discussions or pull requests.

Report them privately through [GitHub's private vulnerability reporting](https://github.com/sai-sahith7/fdfsclub-backend/security/advisories/new). Include:

- what the issue is and what an attacker could do with it
- steps to reproduce, or a proof of concept
- the affected endpoint, file or feature

You'll get a reply within 7 days. Once the issue is confirmed, we'll work on a fix and let you know when it's live. With your permission, we'll credit you in the advisory.

Issues that only affect the web pages belong to [fdfsclub-frontend](https://github.com/sai-sahith7/fdfsclub-frontend/security/advisories/new).

## Supported versions

Only the live service at [fdfsclub.in](https://fdfsclub.in), deployed from `master`, gets security fixes. If you self-host, keep up to date with `master`.

## What we especially care about

- Sign-in and session tokens
- One person reading or changing another person's alerts or account
- The Telegram webhook and bot commands
- Leaks of email addresses, Telegram accounts or other personal data

## Scope

Please don't:

- access, change or delete other people's data
- run automated scans or load tests against fdfsclub.in
- send spam through the alert emails or the Telegram bot
- use social engineering or phishing

Test only with accounts you own.
