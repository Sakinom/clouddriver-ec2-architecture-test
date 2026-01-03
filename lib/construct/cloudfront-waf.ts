import * as cdk from 'aws-cdk-lib';
import {
  aws_wafv2 as wafv2,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class CloudFrontWaf extends Construct {
  public readonly webAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // ------------ CloudFront用WAF (CLOUDFRONT scope) ---------------
    // CloudFront用WAFはus-east-1リージョンでのみ作成可能
    this.webAcl = new wafv2.CfnWebACL(this, 'CloudFrontWebAcl', {
      name: `${cdk.Aws.ACCOUNT_ID}-cloudfront-waf`,
      scope: 'CLOUDFRONT',
      defaultAction: {
        allow: {},
      },
      description: `WAF for CloudFront distribution`,
      rules: [
        // 1. SQL Injection Protection
        {
          name: 'AWSManagedRulesSQLiRuleSet',
          priority: 1,
          overrideAction: {
            none: {},
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesSQLiRuleSet',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'SQLiRuleSetMetric',
          },
        },
        // 2. Cross-Site Scripting (XSS) Protection
        {
          name: 'AWSManagedRulesKnownBadInputsRuleSet',
          priority: 2,
          overrideAction: {
            none: {},
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'KnownBadInputsRuleSetMetric',
          },
        },
        // 3. Path Traversal Protection (included in Core Rule Set)
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 3,
          overrideAction: {
            none: {},
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'CommonRuleSetMetric',
          },
        },
        // 4. IP Reputation List
        {
          name: 'AWSManagedRulesAmazonIpReputationList',
          priority: 4,
          overrideAction: {
            none: {},
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesAmazonIpReputationList',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AmazonIpReputationListMetric',
          },
        },
        // 5. Rate-Based Rule (1000 requests per 5 minutes)
        {
          name: 'RateLimitRule',
          priority: 5,
          action: {
            block: {},
          },
          statement: {
            rateBasedStatement: {
              limit: 1000,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitRuleMetric',
          },
        },
      ],
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `CloudFrontWebAclMetric`,
      },
    });

    const bucket = new cdk.aws_s3.Bucket(this, "awsWafLogsBucket", {
      bucketName: `aws-waf-logs-${cdk.Aws.ACCOUNT_ID}-us-east-1`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
      // TODO: ライフサイクルルールの設定で1年半保持
    });

    // WAFログ出力設定
    const logConfig = new cdk.aws_wafv2.CfnLoggingConfiguration(
      this,
      'wafV2LoggingConfiguration',
      {
        logDestinationConfigs: [`${bucket.bucketArn}/aws-waf-logs-/`],
        resourceArn: this.webAcl.attrArn,
      }
    );
    logConfig.node.addDependency(this.webAcl);
    logConfig.node.addDependency(bucket.node.defaultChild as cdk.CfnResource);
  }
}
