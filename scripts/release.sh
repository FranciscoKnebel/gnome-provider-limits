#!/usr/bin/env bash
# Release helper: bumps the version, commits, pushes, and tags v* on main.
# Usage: ./scripts/release.sh [patch|minor|major]

set -euo pipefail

usage() {
  echo "Usage: $0 <patch|minor|major>" >&2
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

echo "Running checks (npm run check)..."
npm run check

OLD_VERSION=$(node -p "require('./package.json').version")
NEW_VERSION=$(node -p "require('semver').inc('$OLD_VERSION', '$BUMP')")

if [ -z "$NEW_VERSION" ] || [ "$OLD_VERSION" = "$NEW_VERSION" ]; then
  echo "Version did not change ($OLD_VERSION -> ${NEW_VERSION:-unchanged}). Aborting." >&2
  exit 1
fi

echo "Bumping $OLD_VERSION -> $NEW_VERSION ($BUMP)"

# Updates package.json and package-lock.json (top-level + root package entry).
npm version "$BUMP" --no-git-tag-version --allow-same-version
npm install --package-lock-only --no-audit --no-fund

# Bump Project-Id-Version in the gettext catalogue files.
for f in src/po/gnome-provider-limits.pot src/po/*.po; do
  sed -i "s/^\\(\"Project-Id-Version: gnome-provider-limits \\)${OLD_VERSION}\\\\n\"$/\\1${NEW_VERSION}\\\\n\"/" "$f"
done

git add package.json package-lock.json src/po/gnome-provider-limits.pot src/po/*.po
git commit -m "release: v$NEW_VERSION"

echo "Pushing main to origin..."
git push origin main

TAG="v$NEW_VERSION"
git tag -a "$TAG" -m "Release $TAG"
git push origin "$TAG"

echo "Done. Tagged $TAG and pushed. Release workflow should start shortly."