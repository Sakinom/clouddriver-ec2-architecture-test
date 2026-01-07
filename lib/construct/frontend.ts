import * as cdk from "aws-cdk-lib";
import {
  aws_certificatemanager as acm,
  aws_iam as iam,
  aws_s3 as s3,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
} from "aws-cdk-lib";
import { ILoadBalancerV2 } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Construct } from "constructs";

export interface FrontendProps {
  bucketLogRetention: number;
  publicAlb: ILoadBalancerV2;
  cloudfrontWebAclArn?: string;
  domainName: string;
  cloudfrontCertificate: string;
  s3AccessLogBucket: s3.IBucket;
}

export class Frontend extends Construct {
  public readonly staticSiteBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: FrontendProps) {
    super(scope, id);

    // ------------ S3 Static Site Bucket ---------------
    // フロントエンド用S3バケットの作成
    this.staticSiteBucket = new s3.Bucket(this, "StaticSiteBucket", {
      accessControl: s3.BucketAccessControl.PRIVATE,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      serverAccessLogsBucket: props.s3AccessLogBucket,
      serverAccessLogsPrefix: "static-site-bucket-access-logs/",
    });

    // us-east-1のリージョンにあるACM証明書を取得
    const cloudfrontCertificate = acm.Certificate.fromCertificateArn(
      this,
      "CloudFrontCert",
      props.cloudfrontCertificate
    );

    // CloudFrontのログを出すS3バケットを作成
    const cloudfrontLogBucket = new s3.Bucket(this, "CloudFrontLogBucket", {
      accessControl: s3.BucketAccessControl.PRIVATE,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // TODO: 本番環境ではRETAINに変更
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      lifecycleRules: [
        {
          enabled: true,
          expiration: cdk.Duration.days(props.bucketLogRetention),
        },
      ],
      serverAccessLogsBucket: props.s3AccessLogBucket,
      serverAccessLogsPrefix: "cloudfront-log-bucket-access-logs/",
    });

    // クリックジャッキング対策などのセキュリティヘッダを付与
    const securityHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      "SecurityHeadersPolicy",
      {
        comment: "Basic security headers for static front",
        securityHeadersBehavior: {
          contentTypeOptions: { override: true },
          frameOptions: {
            frameOption: cloudfront.HeadersFrameOption.DENY,
            override: true,
          },
          referrerPolicy: {
            referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER,
            override: true,
          },
          strictTransportSecurity: {
            accessControlMaxAge: cdk.Duration.seconds(31536000),
            override: true,
          },
        },
      }
    );

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: new origins.LoadBalancerV2Origin(props.publicAlb),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        responseHeadersPolicy: securityHeadersPolicy,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      },
      additionalBehaviors: {
        "/assets/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(
            this.staticSiteBucket
          ),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, // TODO: CACHING_OPTIMIZEDに変更する
          compress: true,
          responseHeadersPolicy: securityHeadersPolicy,
        },
      },
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.hours(24),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.hours(24),
        },
      ],
      certificate: cloudfrontCertificate,
      domainNames: [props.domainName],
      enableLogging: true,
      logBucket: cloudfrontLogBucket,
      logFilePrefix: "cloudfront-access-logs/",
      ...(props.cloudfrontWebAclArn && { webAclId: props.cloudfrontWebAclArn }),
    });

    // S3バケット（静的コンテンツ用）にCloudFrontからのアクセスを許可する
    this.staticSiteBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:GetObject"],
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        resources: [this.staticSiteBucket.arnForObjects("*")],
        conditions: {
          StringEquals: {
            "AWS:SourceArn": `arn:aws:cloudfront::${
              cdk.Stack.of(this).account
            }:distribution/${this.distribution.distributionId}`,
          },
        },
      })
    );

    // CloudFrontログ設定のためのIAMポリシー
    cloudfrontLogBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:PutObject"],
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        resources: [cloudfrontLogBucket.arnForObjects("*")],
        conditions: {
          StringEquals: {
            "aws:SourceArn": `arn:aws:cloudfront::${
              cdk.Stack.of(this).account
            }:distribution/${this.distribution.distributionId}`,
            "s3:x-amz-acl": "bucket-owner-full-control",
          },
        },
      })
    );

    cloudfrontLogBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:GetBucketAcl"],
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        resources: [cloudfrontLogBucket.bucketArn],
        conditions: {
          StringEquals: {
            "aws:SourceArn": `arn:aws:cloudfront::${
              cdk.Stack.of(this).account
            }:distribution/${this.distribution.distributionId}`,
          },
        },
      })
    );
  }
}
