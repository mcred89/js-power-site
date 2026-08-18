# Workout Generator: JS edition

## Static S3 Site

If you're wanting to reuse this code, you need to:

1. Set up Route53 for your domain
2. Set up ACM for your Route53 Domain. You can just make one cert with a '*'.DOMAIN additional domain.
3. Set up your local AWS cli with your account creds.

And change the below values in serverles.yaml.

1. The custom.siteNames should refelct your own domain names
2. Update the acmARN to your resource ARN from step 2.
3. [OPTIONAL] Update custom.aliasDNSName and provider.region to whatever AWS region you want.

Note that the inital deploy of each stage takes a long time (15-20 minutes). This is CloudFront spin-up time.

## Basic NPM Usage

```bash
npm start # starts dev server
npm run build # bundle for production
npm test # start test runner
```

## Deployment

```bash
# Preview the files that would change without uploading anything
npm run deploy:dry-run

# Test, build, sync to the existing production bucket, and invalidate CloudFront
npm run deploy
```

Deployment uses the AWS CLI's normal credential chain. No credentials are read
from or written to this repository. The deploy script targets the existing
`themcilroy.com` bucket and CloudFront distribution; it does not create or update
S3, Route 53, CloudFront, ACM, or CloudFormation resources.

`serverless.yml` is retained as the definition of the existing infrastructure,
but routine site deployments no longer invoke Serverless or CloudFormation.

## Project was initialized with these steps

```bash
npm install serverless
mkdir js-power-site
cd js-power-site
serverless create -t hello-world -n themcilroy-static -p static
cd static
npm install -g create-react-app
create-react-app js-power-site
```
