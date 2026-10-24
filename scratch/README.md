# scratch

A junk drawer for random asks — one-off experiments, throwaway scripts, spikes,
"can we even do this?" prototypes, and answers to questions that don't belong in
any product directory yet.

Nothing in here is deployed, imported by the app, or covered by CI. The CI
workflows (`.github/workflows/ci.yml`) only build and test `movetrack-api`,
`movetrack-app`, and `db`, so anything under `scratch/` is free to be broken,
half-finished, or written in whatever language is fastest to reach for.

## Layout

One directory per ask, named `YYYY-MM-DD-short-slug`:

```
scratch/
  2026-08-22-csv-import-spike/
    README.md          <- what was asked, what came out of it
    ...whatever else
```

The date prefix means the directory listing sorts chronologically, and a stale
spike is obvious at a glance without opening anything.

## Starting a new ask

```bash
./scratch/new.sh "csv import spike"
```

That creates `scratch/<today>-csv-import-spike/README.md` from `_template.md`
and prints the path. Or just make the directory by hand — the script is a
convenience, not a gate.

## Ground rules

- **No imports across the boundary.** Product code must never import from
  `scratch/`. If a spike earns its keep, move it into the real tree properly
  (with tests) rather than pointing at it from here.
- **Fill in the README.** Two sentences on what was asked and what you concluded
  is the whole value of keeping a spike around. Code with no README is just
  clutter — a month from now nobody remembers why it exists.
- **No secrets.** Real keys, tokens, credentials, and customer data don't go
  here any more than anywhere else. Use `.env.example` patterns and fakes.
- **Delete freely.** Anything with a `Status: done` or `Status: abandoned`
  README is fair game to remove. Git remembers it if it's ever needed again.

## Local-only files

`scratch/.gitignore` ignores common local artifacts (`node_modules/`, venvs,
`out/`, `tmp/`, data dumps) so a quick experiment doesn't accidentally commit a
few hundred megabytes. Add to it as needed.
