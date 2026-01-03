import * as cdk from "aws-cdk-lib";
import {
  aws_certificatemanager as acm,
  aws_ec2 as ec2,
  aws_elasticloadbalancingv2 as elbv2,
  aws_iam as iam,
  aws_s3 as s3,
  region_info as ri,
} from "aws-cdk-lib";
import { Construct } from "constructs";

export interface LoadBalancerProps {
  vpc: ec2.IVpc;
  bucketLogRetention: number;
  albCertificate: acm.ICertificate;
  s3AccessLogBucket: s3.IBucket;
  env: {
    account: string;
    region: string;
  };
}

export class LoadBalancer extends Construct {
  public readonly publicAlb: elbv2.ApplicationLoadBalancer;
  public readonly publicAlbSg: ec2.SecurityGroup;
  public readonly publicAlbListener: elbv2.ApplicationListener;

  constructor(scope: Construct, id: string, props: LoadBalancerProps) {
    super(scope, id);

    // ------------ Public Application LoadBalancer ---------------
    // Public ALBのセキュリティグループ
    this.publicAlbSg = new ec2.SecurityGroup(this, "PublicAlbSg", {
      securityGroupName: `public-alb-sg-${props.env.account}`,
      vpc: props.vpc,
      allowAllOutbound: true,
    });

    this.publicAlbSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow inbound HTTPS traffic"
    );

    // Public Application Load Balancer（外部→Apache+CentOS用）
    this.publicAlb = new elbv2.ApplicationLoadBalancer(this, "PublicAlb", {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: this.publicAlbSg,
      vpcSubnets: props.vpc.selectSubnets({
        subnetGroupName: "Public",
      }),
      loadBalancerName: `public-alb-${props.env.account}`,
    });

    this.publicAlbListener = this.publicAlb.addListener(
      "PublicAlbHttpsListener",
      {
        port: 443,
        certificates: [props.albCertificate],
        sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      }
    );

    // Public ALBのログを出すS3バケットを作成
    const publicAlbLogBucket = new s3.Bucket(this, "PublicAlbLogBucket", {
      accessControl: s3.BucketAccessControl.PRIVATE,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // TODO: 本番環境ではRETAINに変更
      enforceSSL: true,
      lifecycleRules: [
        {
          enabled: true,
          expiration: cdk.Duration.days(props.bucketLogRetention),
        },
      ],
      serverAccessLogsBucket: props.s3AccessLogBucket,
      serverAccessLogsPrefix: "public-alb-log-bucket-access-logs/",
    });

    this.publicAlb.setAttribute("access_logs.s3.enabled", "true");
    this.publicAlb.setAttribute(
      "access_logs.s3.bucket",
      publicAlbLogBucket.bucketName
    );

    // アクセス用のポリシーを追加
    publicAlbLogBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:PutObject"],
        principals: [
          new iam.AccountPrincipal(
            ri.RegionInfo.get(cdk.Stack.of(this).region).elbv2Account
          ),
        ],
        resources: [
          publicAlbLogBucket.arnForObjects(
            `AWSLogs/${cdk.Stack.of(this).account}/*`
          ),
        ],
      })
    );
    publicAlbLogBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:PutObject"],
        principals: [new iam.ServicePrincipal("delivery.logs.amazonaws.com")],
        resources: [
          publicAlbLogBucket.arnForObjects(
            `AWSLogs/${cdk.Stack.of(this).account}/*`
          ),
        ],
        conditions: {
          StringEquals: {
            "s3:x-amz-acl": "bucket-owner-full-control",
          },
        },
      })
    );
    publicAlbLogBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:GetBucketAcl"],
        principals: [new iam.ServicePrincipal("delivery.logs.amazonaws.com")],
        resources: [publicAlbLogBucket.bucketArn],
      })
    );
  }
}
