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

sync_args=(
  build/
  "s3://${site_bucket}/"
  --delete
  --region "${aws_region}"
  --cache-control 'public,max-age=300'
)

if [[ "${dry_run}" == true ]]; then
  echo 'Previewing S3 changes...'
  aws s3 sync "${sync_args[@]}" --dryrun
  echo 'Dry run complete. No files were uploaded and no invalidation was created.'
  exit 0
fi

echo "Deploying to s3://${site_bucket}/..."
aws s3 sync "${sync_args[@]}"

echo 'Setting index.html to revalidate on every visit...'
aws s3 cp build/index.html "s3://${site_bucket}/index.html" \
  --region "${aws_region}" \
  --cache-control 'no-cache' \
  --content-type 'text/html; charset=utf-8'

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

echo 'Running browser smoke tests against production...'
npm run test:smoke:production

echo "Deployment and production smoke tests complete. CloudFront invalidation: ${invalidation_id}"
