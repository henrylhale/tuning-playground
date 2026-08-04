# Working in this repo

See `README.md` for what the apps are. This file covers *how* to work here.

## Multiple Claude instances share this repo

More than one Claude Code instance works on this checkout at a time. **Isolate
yourself before making changes**: use the `EnterWorktree` tool to create a
worktree under `.claude/worktrees/`, which puts you on your own branch in your
own directory.

Do this rather than a second clone. Git refuses to check out the same branch in
two worktrees, so this makes it *impossible* for two instances to sit on `main`
and push conflicting commits — a second clone has no such guard. It also shares
the object store, so your branch is visible to the other instance's
`git branch` right away with no second fetch.

`.claude/` is excluded via `.git/info/exclude` (local-only, so it can't conflict
with anyone), keeping worktree directories out of every checkout's
`git status`.

Consequences worth remembering:

- **Never use bare `git stash` / `git stash pop`.** The stash stack is shared
  across worktrees, so you could pop another instance's work. Prefer a WIP
  commit on your branch.
- The main checkout at the repo root may have another instance's uncommitted
  work in it. Check `git status` there before touching it, and don't
  `git branch -f main` — that would desync their working tree from `HEAD`.
- Untracked files (e.g. a scratch `todo.md`) don't follow you into a worktree.
  That's usually correct: they belong to whoever created them.

## Deploys

`.github/workflows/deploy-to-site.yml` fires **only on push to `main`**, and
only when a top-level `*.html` file or the workflow itself changed. It moves the
`.tuning-version` pointer in the `landing` repo, which republishes
henryhale.com/tuning.

So: work on a branch and nothing ships. Merging to `main` and pushing an
`.html` change *is* a production deploy — treat it as one, and don't push
without being asked.

This repo is the single source of truth for the apps; `landing` pulls them at
the pinned commit. Don't copy built HTML into `landing`.

## Code

Each app is one self-contained HTML file with no build step. The invariant to
protect is the *shipped* artifact: no bundler, no runtime dependencies, no
external CDN scripts. Every app must keep working from a bare `file://` open,
which is also how you verify a change.

Dev-only tooling is fine if it stays zero-dependency and never becomes a
prerequisite for opening the apps.
