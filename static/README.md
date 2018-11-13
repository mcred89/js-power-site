# Workout Generator: JS edition

## Static S3 Site

If you're wanting to reuse this code, you need to:

1. Set up Route53 for your domain
2. Set up ACM for your Route53 Domain. You can just make one cert with a '*'.DOMAIN additional domain.
3. Set up your local AWS cli with your account creds.

And change these value in serverles.yaml:

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
# Dev
# Creates dev.themcilroy.com
npm run build
serverless deploy -v --stage dev
# Prod
# Creates themcilroy.com
npm run build
serverless deploy -v --stage prod
```

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