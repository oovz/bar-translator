set -euo pipefail

commit_sha=$(git rev-parse 'HEAD^{commit}')
find_latest_ci() {
  gh run list --repo "$GITHUB_REPOSITORY" --workflow ci.yml \
    --commit "$commit_sha" --event push --limit 100 \
    --json databaseId,createdAt \
    --jq 'sort_by([.createdAt, .databaseId]) | reverse | .[0].databaseId // empty'
}

ci_run=""
for attempt in {1..12}; do
  ci_run=$(find_latest_ci)
  if [[ -n "$ci_run" ]]; then
    break
  fi
  sleep 5
done

if [[ -z "$ci_run" ]]; then
  if [[ "${CI_ALLOW_MISSING:-false}" != 'true' ]]; then
    echo '::error::CI evidence is missing and standalone-tag checks have not passed.'
    exit 1
  fi
  echo 'run_checks=true' >> "$GITHUB_OUTPUT"
  exit 0
fi

echo "Waiting for CI on $commit_sha"
for attempt in {1..108}; do
  ci_run=$(find_latest_ci)
  if [[ -z "$ci_run" ]]; then
    echo '::error::The matching CI run disappeared before publication.'
    exit 1
  fi
  state=$(gh run view "$ci_run" --repo "$GITHUB_REPOSITORY" \
    --json status,conclusion --jq '.status + " " + .conclusion')
  if [[ "$state" == 'completed success' ]]; then
    latest_ci_run=$(find_latest_ci)
    if [[ "$latest_ci_run" == "$ci_run" ]]; then
      echo 'run_checks=false' >> "$GITHUB_OUTPUT"
      exit 0
    fi
  elif [[ "$state" == completed* ]]; then
    echo "::error::CI run $ci_run did not succeed ($state)."
    exit 1
  fi
  sleep 10
done

echo '::error::CI did not finish before the release deadline.'
exit 1
