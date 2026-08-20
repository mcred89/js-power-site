#!/usr/bin/env bash

set -euo pipefail

site_bucket='themcilroy.com'
cloudfront_distribution_id='E16RDQO3O2PUGY'
aws_region='us-west-2'
dry_run=false

if [[ "${1:-}" == '--dry-run' ]]; then
  dry_run=true
elif [[ $# -gt 0 ]]; then
  echo "Usage: npm run deploy [-- --dry-run]" >&2
  exit 2
fi

command -v aws >/dev/null 2>&1 || {
  echo 'The AWS CLI is required but was not found.' >&2
  exit 1
}

echo 'Verifying AWS access and deployment target...'
aws sts get-caller-identity --query Account --output text >/dev/null
aws s3api head-bucket --bucket "${site_bucket}"

echo 'Running tests...'
CI=true npm test -- --watchAll=false

echo 'Building the production site...'
npm run build

echo 'Running browser smoke tests against the production build...'
npm run test:smoke

static_sync_args=(
  build/static/
  "s3://${site_bucket}/static/"
  --delete
  --region "${aws_region}"
  --exclude '*.map'
  --cache-control 'public,max-age=31536000,immutable'
)

root_sync_args=(
  build/
  "s3://${site_bucket}/"
  --delete
  --region "${aws_region}"
  # Excluded objects are protected from --delete. Hashed assets are handled by
  # the immutable sync, while the two shell files receive no-cache below.
  --exclude 'static/*'
  --exclude '*.map'
  --exclude 'index.html'
  --exclude 'service-worker.js'
  --cache-control 'public,max-age=300'
)

shell_copy_args=(
  --region "${aws_region}"
  --cache-control 'no-cache'
)

map_remove_args=(
  "s3://${site_bucket}/static/"
  --recursive
  --region "${aws_region}"
  --exclude '*'
  --include '*.map'
)

if [[ "${dry_run}" == true ]]; then
  echo 'Previewing immutable static asset changes...'
  aws s3 sync "${static_sync_args[@]}" --dryrun
  echo 'Previewing short-lived root asset changes...'
  aws s3 sync "${root_sync_args[@]}" --dryrun
  echo 'Previewing no-cache shell uploads...'
  aws s3 cp build/index.html "s3://${site_bucket}/index.html" "${shell_copy_args[@]}" --content-type 'text/html; charset=utf-8' --dryrun
  aws s3 cp build/service-worker.js "s3://${site_bucket}/service-worker.js" "${shell_copy_args[@]}" --content-type 'application/javascript; charset=utf-8' --dryrun
  echo 'Previewing removal of previously published source maps under static/ only...'
  aws s3 rm "${map_remove_args[@]}" --dryrun
  echo 'Dry run complete. No files were uploaded and no invalidation was created.'
  exit 0
fi

echo "Deploying immutable assets to s3://${site_bucket}/static/..."
aws s3 sync "${static_sync_args[@]}"

echo "Deploying short-lived root assets to s3://${site_bucket}/..."
aws s3 sync "${root_sync_args[@]}"

echo 'Publishing shell files with no-cache...'
aws s3 cp build/index.html "s3://${site_bucket}/index.html" \
  "${shell_copy_args[@]}" \
  --content-type 'text/html; charset=utf-8'
aws s3 cp build/service-worker.js "s3://${site_bucket}/service-worker.js" \
  "${shell_copy_args[@]}" \
  --content-type 'application/javascript; charset=utf-8'

# Maps remain in local builds for diagnostics, but must never be public. This
# removal is deliberately rooted at the production bucket's static/ prefix.
echo 'Removing previously published source maps under static/...'
aws s3 rm "${map_remove_args[@]}"

echo 'Invalidating CloudFront...'
invalidation_id="$(aws cloudfront create-invalidation \
  --distribution-id "${cloudfront_distribution_id}" \
  --paths '/*' \
  --query 'Invalidation.Id' \
  --output text)"

echo "Waiting for CloudFront invalidation ${invalidation_id}..."
aws cloudfront wait invalidation-completed \
  --distribution-id "${cloudfront_distribution_id}" \
  --id "${invalidation_id}"

echo 'Verifying production cache headers...'
node scripts/verify-deployment-headers.js "https://${site_bucket}"

echo 'Running browser smoke tests against production...'
npm run test:smoke:production

echo "Deployment and production smoke tests complete. CloudFront invalidation: ${invalidation_id}"
