#!/bin/bash
# Cut a release: set the version, commit, tag and push.
#
#   ./scripts/release.sh 0.6.0
#
# Pushing the v0.6.0 tag runs .github/workflows/release.yml, which builds
# the app and publishes the GitHub release with the DMG attached. The app
# checks that release to tell people an update is out.
set -euo pipefail
cd "$(dirname "$0")/.."

version="${1:-}"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: $0 <major.minor.patch>" >&2
  exit 1
fi
tag="v$version"

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != main ]; then
  echo "Release from main (on $branch)." >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "Commit or stash your changes first." >&2
  exit 1
fi
git fetch --tags origin
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "$tag already exists." >&2
  exit 1
fi
latest=$(git tag --list 'v[0-9]*' --sort=-v:refname | head -1)
if [ -n "$latest" ] && [ "$(printf '%s\n%s\n' "${latest#v}" "$version" | sort -V | tail -1)" != "$version" ]; then
  echo "$tag isn't newer than $latest." >&2
  exit 1
fi

./scripts/set-version.sh "$version"
git add package.json app/package.json tauri/package.json tauri/src-tauri/tauri.conf.json \
  tauri/src-tauri/Cargo.toml tauri/src-tauri/Cargo.lock backend/pyproject.toml backend/__init__.py
git commit -m "chore: release $tag"
git tag -a "$tag" -m "Herga $version"
git push origin main "$tag"

echo
echo "Pushed $tag. The release workflow builds the app and publishes the release:"
echo "  https://github.com/mrgnhnt96/herga/actions/workflows/release.yml"
