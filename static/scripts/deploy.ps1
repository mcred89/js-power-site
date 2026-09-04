[CmdletBinding()]
param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$siteBucket = 'themcilroy.com'
$cloudFrontDistributionId = 'E16RDQO3O2PUGY'
$awsRegion = 'us-west-2'

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $Command $($Arguments -join ' ')"
  }
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  throw 'The AWS CLI is required but was not found.'
}

Write-Host 'Verifying AWS access and deployment target...'
Invoke-External aws sts get-caller-identity --query Account --output text
Invoke-External aws s3api head-bucket --bucket $siteBucket

Write-Host 'Running tests...'
$previousCi = $env:CI
try {
  $env:CI = 'true'
  Invoke-External npm test '--' --watchAll=false
} finally {
  $env:CI = $previousCi
}

Write-Host 'Building the production site...'
Invoke-External npm run build

Write-Host 'Running browser smoke tests against the production build...'
Invoke-External npm run test:smoke

$staticSyncArgs = @(
  's3', 'sync', 'build/static/', "s3://${siteBucket}/static/",
  '--delete', '--region', $awsRegion,
  '--exclude', '*.map',
  '--cache-control', 'public,max-age=31536000,immutable'
)
$rootSyncArgs = @(
  's3', 'sync', 'build/', "s3://${siteBucket}/",
  '--delete', '--region', $awsRegion,
  '--exclude', 'static/*',
  '--exclude', '*.map',
  '--exclude', 'index.html',
  '--exclude', 'service-worker.js',
  '--cache-control', 'public,max-age=300'
)
$shellCopyArgs = @(
  '--region', $awsRegion,
  '--cache-control', 'no-cache'
)
$mapRemoveArgs = @(
  's3', 'rm', "s3://${siteBucket}/static/",
  '--recursive', '--region', $awsRegion,
  '--exclude', '*',
  '--include', '*.map'
)

if ($DryRun) {
  Write-Host 'Previewing immutable static asset changes...'
  Invoke-External aws @staticSyncArgs --dryrun
  Write-Host 'Previewing short-lived root asset changes...'
  Invoke-External aws @rootSyncArgs --dryrun
  Write-Host 'Previewing no-cache shell uploads...'
  Invoke-External aws s3 cp build/index.html "s3://${siteBucket}/index.html" @shellCopyArgs --content-type 'text/html; charset=utf-8' --dryrun
  Invoke-External aws s3 cp build/service-worker.js "s3://${siteBucket}/service-worker.js" @shellCopyArgs --content-type 'application/javascript; charset=utf-8' --dryrun
  Write-Host 'Previewing removal of previously published source maps under static/ only...'
  Invoke-External aws @mapRemoveArgs --dryrun
  Write-Host 'Dry run complete. No files were uploaded and no invalidation was created.'
  exit 0
}

Write-Host "Deploying immutable assets to s3://${siteBucket}/static/..."
Invoke-External aws @staticSyncArgs

Write-Host "Deploying short-lived root assets to s3://${siteBucket}/..."
Invoke-External aws @rootSyncArgs

Write-Host 'Publishing shell files with no-cache...'
Invoke-External aws s3 cp build/index.html "s3://${siteBucket}/index.html" @shellCopyArgs --content-type 'text/html; charset=utf-8'
Invoke-External aws s3 cp build/service-worker.js "s3://${siteBucket}/service-worker.js" @shellCopyArgs --content-type 'application/javascript; charset=utf-8'

Write-Host 'Removing previously published source maps under static/...'
Invoke-External aws @mapRemoveArgs

Write-Host 'Invalidating CloudFront...'
$invalidationId = & aws cloudfront create-invalidation `
  --distribution-id $cloudFrontDistributionId `
  --paths '/*' `
  --query 'Invalidation.Id' `
  --output text
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to create the CloudFront invalidation.'
}
$invalidationId = $invalidationId.Trim()

Write-Host "Waiting for CloudFront invalidation ${invalidationId}..."
Invoke-External aws cloudfront wait invalidation-completed --distribution-id $cloudFrontDistributionId --id $invalidationId

Write-Host 'Verifying production cache headers...'
Invoke-External node scripts/verify-deployment-headers.js "https://${siteBucket}"

Write-Host 'Running browser smoke tests against production...'
$previousSmokeBaseUrl = $env:SMOKE_BASE_URL
try {
  $env:SMOKE_BASE_URL = "https://${siteBucket}"
  Invoke-External npm run test:smoke
} finally {
  $env:SMOKE_BASE_URL = $previousSmokeBaseUrl
}

Write-Host "Deployment and production smoke tests complete. CloudFront invalidation: ${invalidationId}"
