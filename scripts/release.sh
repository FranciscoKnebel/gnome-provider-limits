#!/usr/bin/env bash
# Prepare and publish a release from the latest version tag.
# Usage: npm run release -- [patch|minor|major]

set -euo pipefail

usage() {
  echo "Usage: npm run release -- [patch|minor|major]" >&2
  exit 1
}

BUMP="${1:-}"
case "$BUMP" in
  patch|minor|major) ;;
  "")
    echo "Select a bump type:" >&2
    select BUMP in patch minor major; do
      case "$BUMP" in
        patch|minor|major) break ;;
        *) echo "Invalid choice." >&2; exit 1 ;;
      esac
    done ;;
  *) usage ;;
esac

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "Must be on main (currently on $BRANCH)." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean. Commit or stash first." >&2
  git status --short >&2
  exit 1
fi

echo "Fetching origin/main..."
git fetch --no-tags origin main

LOCAL_HEAD=$(git rev-parse HEAD)
REMOTE_HEAD=$(git rev-parse refs/remotes/origin/main)
if [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
  echo "Local main must match origin/main before releasing." >&2
  echo "Local:  $LOCAL_HEAD" >&2
  echo "Remote: $REMOTE_HEAD" >&2
  exit 1
fi

LATEST_TAG=$(git ls-remote --tags --refs origin 'refs/tags/v*' | awk '{ sub("refs/tags/", "", $2); print $2 }' | sort -V | tail -n 1)
if [ -z "$LATEST_TAG" ]; then
  echo "No version tag was found on origin." >&2
  exit 1
fi

BASE_VERSION="${LATEST_TAG#v}"
if ! node -e "process.exit(require('semver').valid(process.argv[1]) ? 0 : 1)" "$BASE_VERSION"; then
  echo "Latest remote tag is not a valid semantic version: $LATEST_TAG" >&2
  exit 1
fi

echo "Fetching latest release tag $LATEST_TAG..."
git fetch --force origin "refs/tags/$LATEST_TAG:refs/release-base/$LATEST_TAG"
BASE_COMMIT=$(git rev-parse "refs/release-base/$LATEST_TAG^{commit}")
if ! git merge-base --is-ancestor "$BASE_COMMIT" HEAD; then
  echo "Latest remote tag $LATEST_TAG is not an ancestor of origin/main." >&2
  exit 1
fi

NEW_VERSION=$(node -e "process.stdout.write(require('semver').inc(process.argv[1], process.argv[2]) || '')" "$BASE_VERSION" "$BUMP")
if [ -z "$NEW_VERSION" ]; then
  echo "Could not calculate the next version from $LATEST_TAG ($BUMP)." >&2
  exit 1
fi

TAG="v$NEW_VERSION"
if git ls-remote --exit-code --tags --refs origin "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "Tag $TAG already exists on origin." >&2
  exit 1
fi

CURRENT_PACKAGE_VERSION=$(node -p "require('./package.json').version")
echo "Preparing $TAG from $LATEST_TAG. package.json is currently $CURRENT_PACKAGE_VERSION and will be synchronized."

echo "Running checks (npm run check)..."
npm run check

npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version

python3 - "$NEW_VERSION" <<'PY'
from pathlib import Path
import sys

version = sys.argv[1]
prefix = '"Project-Id-Version: gnome-provider-limits '
paths = [Path("src/po/gnome-provider-limits.pot"), *sorted(Path("src/po").glob("*.po"))]

for path in paths:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    matches = [index for index, line in enumerate(lines) if line.startswith(prefix)]
    if len(matches) != 1:
        raise SystemExit(f"Expected one Project-Id-Version header in {path}, found {len(matches)}")

    index = matches[0]
    line_ending = "\r\n" if lines[index].endswith("\r\n") else "\n" if lines[index].endswith("\n") else ""
    lines[index] = f'{prefix}{version}\\n"{line_ending}'
    path.write_text("".join(lines), encoding="utf-8")
PY

git add package.json package-lock.json src/po/gnome-provider-limits.pot src/po/*.po
git commit -m "release: $TAG"
git tag -a "$TAG" -m "Release $TAG"

echo "Pushing main and $TAG atomically..."
git push --atomic origin main "$TAG"

echo "Done. The tag workflow will validate, build the extension ZIP, and create the GitHub release."
