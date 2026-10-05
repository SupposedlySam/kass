# This fork

This is a fork of [Morgan's Kass](https://github.com/mrgnhnt96/kass). Morgan's app is for dictation only. This fork is his app plus **Read Aloud**: select text in any app, press a chord, and Kass reads it to you with Kokoro (docs/plans/READ_ALOUD.md).

Everything else is meant to stay the same as upstream. Bug fixes and features that aren't Read Aloud go to Morgan as pull requests, then come back here when we merge upstream.

## Remotes

| Remote | Repository | Used for |
| --- | --- | --- |
| `origin` | `SupposedlySam/kass` (this fork) | Our `main`, and branches for PRs to Morgan |
| `upstream` | `mrgnhnt96/kass` | Fetching Morgan's changes. Fetch only: its push URL is disabled so nothing goes to Morgan except through a PR |

A new clone sets them up like this:

```sh
git clone git@github.com:SupposedlySam/kass.git && cd kass
git remote add upstream git@github.com:mrgnhnt96/kass.git
git remote set-url --push upstream no-push--open-a-PR-from-origin-instead
just setup-hooks
```

## What only this fork has

- Read Aloud: the backend (`services/speech.py`, `services/speakable.py`, `backends/kokoro_backend.py`, `routes/speech.py`), the chord and player (`tauri/src-tauri/src/read_aloud.rs`), the settings page, the onboarding step, and their docs.
- **Read naturally** (on by default, in Settings › Read Aloud): text is read the way you'd say it, with a pause wherever a slash or bracket was. A lone letter "A" is said "ay", not "uh".
- Updates come from this fork's releases, not Morgan's (`tauri.conf.json`'s updater endpoint and `BETA_ENDPOINT` in `updater.rs`). Otherwise a copy built here would replace itself with Morgan's next release, which has no Read Aloud. The fork publishes no releases, so a copy built here keeps the version it was built from until you run `just install` again.
- This file and `scripts/fork/`.

`CHANGELOG.md` is Morgan's, and the website shows it, so fork-only changes go in the list above, not there. That also keeps syncs from conflicting over it.

## Merging Morgan's changes in

```sh
git checkout main
scripts/fork/sync-upstream --dry   # what would merge, and what's skipped
scripts/fork/sync-upstream
just check && just test
git push origin main
just install                       # run the updated app
```

`sync-upstream` merges `upstream/main` into the current branch, except for the commits listed in `scripts/fork/skip-upstream`. Those are upstream commits that remove things only this fork keeps, like the Read Aloud removal. Each is merged with `git merge -s ours`, so git counts it as merged and never offers it again, but its changes are left out. A plain `git merge upstream/main` would apply them and delete Read Aloud here.

When Morgan merges a change that takes out something this fork keeps, add the commit as it landed on his `main` to `scripts/fork/skip-upstream` before syncing. For a squash merge that's the squashed commit, for a merge commit it's the merge commit, and for a rebase merge it's each rebased commit.

Conflicts are most likely where Read Aloud touches shared files: capture settings (`database/models.py`, `migrations.py`, `models.py`, `services/settings.py`), the chord code (`hotkey_monitor.rs`, `main.rs`), the pill, onboarding, and the settings pages. Keep both sides.

## Sending a fix or feature to Morgan

Anything that isn't Read Aloud starts from Morgan's code, not ours, so the PR carries none of the fork:

```sh
git fetch upstream
git checkout -b fix/short-name upstream/main
# make the change, commit
git push -u origin fix/short-name
gh pr create --repo mrgnhnt96/kass --base main --head SupposedlySam:fix/short-name
```

Once Morgan merges it, `sync-upstream` brings it into our `main`. If the fix is needed here before then, cherry-pick it onto `main`. When upstream later lands the same change, git usually sees it's already there, and any conflict is between two copies of the same fix.

A change made on our `main` that turns out to be general can go the same way: branch from `upstream/main` and `git cherry-pick` it, leaving out any Read Aloud parts.
