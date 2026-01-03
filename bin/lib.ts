#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { CloudFrontWafStack } from '../lib/stack/cloudfront-waf-stack';
import { Ec2Stack } from '../lib/stack/ec2-stack';
import { parameter } from '../parameter';

const app = new cdk.App();

// CloudFront用WAFスタック（us-east-1リージョン）
// const cloudfrontWafStack = new CloudFrontWafStack(
//   app,
//   `CloudFrontWaf`,
//   {
//     appName: parameter.appName,
//     environment: parameter.environment,
//     env: {
//       account: parameter.env.account,
//       region: "us-east-1", // CloudFront WAFはus-east-1でのみ作成可能
//     },
//     crossRegionReferences: true,
//     description: `CloudFront WAF Stack (${parameter.environment})`,
//   }
// );

new Ec2Stack(app, `Ec2Stack`, {
  env: parameter.env,
  description: parameter.description,
  vpcCidr: parameter.vpcCidr,
  maxAzs: parameter.maxAzs,
  natGateways: parameter.natGateways,
  domainName: parameter.domainName,
  cloudfrontCertificate: parameter.cloudfrontCertificate,
  cloudWatchLogsRetention: parameter.cloudWatchLogsRetention,
  bucketLogRetention: parameter.bucketLogRetention,
  notificationRecipientEmail: parameter.notificationRecipientEmail,
  canaryUrl: parameter.canaryUrl,
  cloudTrailLogRetention: parameter.cloudTrailLogRetention,
  datastore: parameter.datastore,
  appService: parameter.appService,
  webAclArn: parameter.webAclArn,
});
