#!/usr/bin/env bash
set -euo pipefail
cd release-assets
sha256sum --check SHA256SUMS.txt
# Normal SemVer tags publish stable/Latest automatically. Keep an
# explicitly requested -rc/-beta tag out of the stable update channel.
version=${RELEASE_TAG#v}
version=${version%%+*}
prerelease=false
latest=true
channel=release
if [[ "$version" == *-* ]]; then
  prerelease=true
  latest=false
  channel=prerelease
fi
if gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  draft=$(gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json isDraft --jq .isDraft)
  if [ "$draft" != true ]; then
    echo "Refusing to replace assets of a published release" >&2
    exit 1
  fi
  # An old/manual draft may already contain standalone services.
  # Do not silently publish those alongside the desktop whitelist.
  existing_assets=$(gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json assets --jq '.assets[].name')
  while IFS= read -r asset; do
    [ -n "$asset" ] || continue
    if [[ "$asset" == */* ]] || [ ! -f "$asset" ]; then
      echo "Draft contains an excluded asset: $asset; remove it or use a new tag" >&2
      exit 1
    fi
  done <<< "$existing_assets"
else
  gh release create "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" \
    --verify-tag --draft --prerelease="$prerelease" \
    --title "Faber $RELEASE_TAG" \
    --notes-file ../.github/release-notes.md
fi
gh release upload "$RELEASE_TAG" ./* --repo "$GITHUB_REPOSITORY" --clobber
# Keep incomplete uploads private. Publish only after every upload
# succeeds. No manual draft publication is required.
gh release edit "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" \
  --title "Faber $RELEASE_TAG" --draft=false --prerelease="$prerelease" --latest="$latest"
url=$(gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json url --jq .url)
printf 'Published %s: %s\n' "$channel" "$url"
printf '### Published %s\n\n[%s](%s)\n' "$channel" "$RELEASE_TAG" "$url" >> "$GITHUB_STEP_SUMMARY"
