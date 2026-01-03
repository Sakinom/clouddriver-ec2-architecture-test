import { Construct } from "constructs";
import { RemovalPolicy, Duration, Stack } from "aws-cdk-lib";
import { Trail } from "aws-cdk-lib/aws-cloudtrail";
import { Bucket, BucketEncryption, IBucket } from "aws-cdk-lib/aws-s3";
import { Key } from "aws-cdk-lib/aws-kms";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Role } from "aws-cdk-lib/aws-iam";

export interface CloudTrailProps {
  cmk: Key;
  cloudTrailLogRetention: number;
  s3AccessLogBucket: IBucket;
  env: {
    account: string;
    region: string;
  };
}

export class CloudTrail extends Construct {
  public readonly trail: Trail;
  public readonly logBucket: Bucket;
  public readonly cloudWatchLogGroup: LogGroup;

  constructor(scope: Construct, id: string, props: CloudTrailProps) {
    super(scope, id);

    // CloudTrailログ用のS3バケットを作成
    this.logBucket = new Bucket(this, "CloudTrailLogBucket", {
      encryption: BucketEncryption.KMS,
      encryptionKey: props.cmk,
      versioned: true,
      lifecycleRules: [
        {
          id: "DeleteOldLogs",
          enabled: true,
          expiration: Duration.days(props.cloudTrailLogRetention),
          noncurrentVersionExpiration: Duration.days(1),
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY, // TODO: 開発環境用。本番では RETAIN を推奨
      serverAccessLogsBucket: props.s3AccessLogBucket,
      serverAccessLogsPrefix: "cloudtrail-log-bucket-access-logs/",
    });

    // CloudTrailサービスがKMSキーを使用できるように権限を追加
    props.cmk.addToResourcePolicy(
      new PolicyStatement({
        sid: "Enable CloudTrail Encrypt",
        principals: [new ServicePrincipal("cloudtrail.amazonaws.com")],
        actions: [
          "kms:GenerateDataKey*",
          "kms:DescribeKey",
          "kms:Encrypt",
          "kms:ReEncrypt*",
          "kms:Decrypt",
        ],
        resources: ["*"],
        conditions: {
          StringEquals: {
            "kms:EncryptionContext:aws:cloudtrail:arn": `arn:aws:cloudtrail:${
              Stack.of(this).region
            }:${Stack.of(this).account}:trail/${props.env.account}-cloudtrail`,
          },
        },
      })
    );

    // CloudTrailサービスがS3バケットにアクセスできるように権限を追加
    this.logBucket.addToResourcePolicy(
      new PolicyStatement({
        sid: "AWSCloudTrailAclCheck",
        principals: [new ServicePrincipal("cloudtrail.amazonaws.com")],
        actions: ["s3:GetBucketAcl"],
        resources: [this.logBucket.bucketArn],
        conditions: {
          StringEquals: {
            "AWS:SourceArn": `arn:aws:cloudtrail:${Stack.of(this).region}:${
              Stack.of(this).account
            }:trail/${props.env.account}-cloudtrail`,
          },
        },
      })
    );

    this.logBucket.addToResourcePolicy(
      new PolicyStatement({
        sid: "AWSCloudTrailWrite",
        principals: [new ServicePrincipal("cloudtrail.amazonaws.com")],
        actions: ["s3:PutObject"],
        resources: [`${this.logBucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            "s3:x-amz-acl": "bucket-owner-full-control",
            "AWS:SourceArn": `arn:aws:cloudtrail:${Stack.of(this).region}:${
              Stack.of(this).account
            }:trail/${props.env.account}-cloudtrail`,
          },
        },
      })
    );

    // CloudWatch Logsロググループを作成
    this.cloudWatchLogGroup = new LogGroup(this, "CloudTrailLogGroup", {
      logGroupName: `/aws/cloudtrail/${props.env.account}`,
      retention: RetentionDays.ONE_YEAR,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // CloudTrailがCloudWatch Logsに書き込むためのIAMロールを作成
    const cloudTrailRole = new Role(this, "CloudTrailRole", {
      assumedBy: new ServicePrincipal("cloudtrail.amazonaws.com"),
    });

    // CloudWatch LogsへのPutLogEvents権限を付与
    this.cloudWatchLogGroup.grantWrite(cloudTrailRole);

    // CloudTrailを作成
    this.trail = new Trail(this, "CloudTrail", {
      trailName: `${props.env.account}-cloudtrail`,
      bucket: this.logBucket,
      includeGlobalServiceEvents: true, // グローバルサービス（IAM、CloudFrontなど）のイベントを含める
      isMultiRegionTrail: true, // 全リージョンのイベントを記録
      enableFileValidation: true, // ログファイルの整合性検証を有効化
      encryptionKey: props.cmk, // KMSキーで暗号化
      sendToCloudWatchLogs: true, // CloudWatch Logsへの送信を有効化
      cloudWatchLogGroup: this.cloudWatchLogGroup,
      cloudWatchLogsRetention: RetentionDays.ONE_YEAR,
    });
  }
}
