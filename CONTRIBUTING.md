# Contributing to FDFSClub

Thanks for helping out. Bug reports, ideas and pull requests are all welcome.

## Before you start

- For anything bigger than a small fix, open an [issue](https://github.com/sai-sahith7/fdfsclub-backend/issues) first so we can agree on the approach.
- Problems with pages, layout or the create-alert flow belong in [fdfsclub-frontend](https://github.com/sai-sahith7/fdfsclub-frontend/issues).
- Found a security issue? Don't open a public issue. See [SECURITY.md](SECURITY.md).

## Setup

You need Node 20 or newer and a MongoDB database.

```bash
npm install
cp .env.example .env   # then fill it in
npm run dev            # API on http://localhost:8000
npm run worker         # scan workers, in a second terminal
```

The README lists every environment variable. You only need the ones for the part you're working on.

The tests don't need a `.env`. They start their own in-memory MongoDB.

## Making a change

1. Fork the repo and create a branch from `master`.
2. Keep changes focused on one thing.
3. Add or update tests for new behaviour.
4. Make sure `npm run lint` and `npm test` pass. CI runs them on every pull request.
5. Open a pull request that says what changed and how you tested it.

## Guidelines

- Be gentle with the booking sites. Don't run the workers in tight loops or scan many cities at once while testing, and never raise the request limits to speed things up.
- Never commit `.env`, tokens or real user data. Use made-up data in tests.
- Add new environment variables to `.env.example` and the README.
- Keep user-facing text (emails, Telegram messages) plain and short. Write "FDFSClub", say "tickets open", use a plain hyphen for ranges and no em dashes. Don't name internal services; `tests/unit/copyGuard.test.js` checks this.
- Code has no comments. Use clear names instead.

## Commit messages

Use one short line in the [Conventional Commits](https://www.conventionalcommits.org) style, for example `fix(alerts): skip shows that already started`.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
