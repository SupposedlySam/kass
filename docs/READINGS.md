# Readings

When each front-door doc was last read **whole**, front to back, by kass's owner agent, at which commit, and what that reading found. A keyword search can't tell you a doc stopped making sense; a stale sentence is invisible to grep and obvious on page two. Re-read and update a row whenever the doc or what it describes changes.

| Doc | Read whole | At | Found |
| --- | --- | --- | --- |
| `README.md` | 2026-10-08 | `a4c648bc` | **Stale, upstream:** "Private. No account, no server, no analytics." The built app sends anonymous daily usage stats to Amplitude unless the user opts out at the end of onboarding (`backend/services/usage_report.py`, since `fc5597c7`). Morgan's privacy page says so; this line doesn't. It's Morgan's file, so the fix goes to him. **Misleading on the fork:** "Install: download the latest DMG from Releases" installs Morgan's app, which has no Read Aloud. `FORK.md` explains it; the README is left as upstream's to keep syncs clean. |
| `FORK.md` | 2026-10-08 | `a4c648bc` | Accurate. Its warning that a rebase-merged removal lands as several commits, each needing a `skip-upstream` line, is the one that mattered: Morgan's Read Aloud removal (his #4) arrived as six. |
| `justfile` | 2026-10-01 | `16a1451` | Accurate. |
| `scripts/install.sh` | 2026-10-08 | `a4c648bc` | Accurate. Since upstream `e133d6c` it also turns internal features on for every checkout build (`~/Library/Application Support/com.mrgnhnt.kass/internal`). |
| `scripts/fork/sync-upstream` | 2026-10-08 | `a4c648bc` | Accurate. Its protected-file check stops only at a commit that *deletes* a fork-only file; a removal commit that only edits shared files (README, changelog) would merge unless it is listed. |
| `docs/plans/*.md` (31 files) | never | | Not read. Background design notes, not front-door docs. |
| `docs/DICTATION_HANDSHAKE.md` | never | | Not read. New upstream (`e69d4f53`). |

There is no `CLAUDE.md` or `llms.txt` in this repo.
