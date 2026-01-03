import * as cdk from 'aws-cdk-lib';
import {
  aws_synthetics as synthetics,
  aws_s3 as s3,
  aws_iam as iam,
  aws_cloudwatch as cw,
  aws_cloudwatch_actions as cw_actions,
  aws_sns as sns,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface CanaryProps {
  canaryUrl: string;
  snsTopic: sns.ITopic;
  s3AccessLogBucket: s3.IBucket;
}

export class Canary extends Construct {
  public readonly canary: synthetics.Canary;
  public readonly canaryAlarm: cw.Alarm;
  public readonly artifactsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: CanaryProps) {
    super(scope, id);

    // Canaryの成果物保存用S3バケット
    this.artifactsBucket = new s3.Bucket(this, 'CanaryArtifactsBucket', {
      bucketName: `canary-artifacts-${cdk.Aws.ACCOUNT_ID}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          id: 'DeleteOldArtifacts',
          enabled: true,
          expiration: cdk.Duration.days(30),
        },
      ],
      serverAccessLogsBucket: props.s3AccessLogBucket,
      serverAccessLogsPrefix: "canary-artifacts-bucket-access-logs/",
    });

    // Canary実行用IAMロール
    const canaryRole = new iam.Role(this, 'CanaryRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // S3バケットへの書き込み権限を追加
    this.artifactsBucket.grantWrite(canaryRole);

    // CloudWatch Canaryの作成
    this.canary = new synthetics.Canary(this, 'WebsiteCanary', {
      canaryName: `website-canary`,
      schedule: synthetics.Schedule.rate(cdk.Duration.minutes(5)),
      test: synthetics.Test.custom({
        code: synthetics.Code.fromInline(`
const synthetics = require('Synthetics');
const log = require('SyntheticsLogger');

const checkWebsite = async function () {
    const config = synthetics.getConfiguration();
    config.setConfig({
        includeRequestHeaders: true,
        includeResponseHeaders: true,
        restrictedHeaders: [],
        restrictedUrlParameters: []
    });

    const url = '${props.canaryUrl}';

    try {
        const response = await synthetics.executeStep('checkWebsite', async function () {
            return await synthetics.getPage().goto(url, {
                waitUntil: 'networkidle0',
                timeout: 30000
            });
        });

        if (response.status() !== 200) {
            throw new Error(\`Expected status 200, but got \${response.status()}\`);
        }

        log.info('Website check passed successfully');
        return response;
    } catch (error) {
        log.error('Website check failed:', error);
        throw error;
    }
};

exports.handler = async () => {
    return await synthetics.executeStep('canary', checkWebsite);
};
        `),
        handler: 'index.handler',
      }),
      runtime: synthetics.Runtime.SYNTHETICS_NODEJS_PUPPETEER_6_2,
      role: canaryRole,
      artifactsBucketLocation: {
        bucket: this.artifactsBucket,
      },
      failureRetentionPeriod: cdk.Duration.days(30),
      successRetentionPeriod: cdk.Duration.days(30),
    });

    // Canary失敗時のアラーム
    this.canaryAlarm = new cw.Alarm(this, 'CanaryAlarm', {
      alarmName: `canary-alarm`,
      alarmDescription: `Website availability check failed`,
      metric: new cw.Metric({
        namespace: 'CloudWatchSynthetics',
        metricName: 'SuccessPercent',
        dimensionsMap: {
          CanaryName: this.canary.canaryName,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 100,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cw.TreatMissingData.BREACHING,
    });

    // アラームアクションの設定
    this.canaryAlarm.addAlarmAction(new cw_actions.SnsAction(props.snsTopic));

    // タグの追加
    cdk.Tags.of(this.canary).add('Name', `website-canary`);
    cdk.Tags.of(this.canaryAlarm).add('Name', `canary-alarm`);
    cdk.Tags.of(this.artifactsBucket).add('Name', `canary-artifacts`);
  }
}
