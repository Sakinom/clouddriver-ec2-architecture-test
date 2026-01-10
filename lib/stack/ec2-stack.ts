import { Duration, Names, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Key } from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';
import { Ec2App } from '../construct/ec2app';
import { Monitoring } from '../construct/monitoring';
import { Networking } from '../construct/networking';
import { Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { Datastore } from '../construct/datastore';
import { EnvironmentParameter } from '../../parameter';
import { Dns } from '../construct/dns';
import { LoadBalancer } from '../construct/loadbalancer';
import { CloudTrail } from '../construct/cloudtrail';
import { Frontend } from '../construct/frontend';
import { Canary } from '../construct/canary';
import { GuardDuty } from '../construct/guardduty';
import { AwsConfig } from '../construct/awsconfig';
import { ElastiCache } from '../construct/elasticache';
import { GitHubOidc } from '../construct/github-oidc';
import { Batch } from '../construct/batch';
import { CodeDeploy } from '../construct/codedeploy';

export interface Ec2StackProps extends StackProps {
  env: {
    account: string;
    region: string;
  };
  description: string;
  vpcCidr: string;
  maxAzs: number;
  natGateways: number;
  domainName: string;
  cloudfrontCertificate: string;
  cloudWatchLogsRetention: number;
  bucketLogRetention: number;
  notificationRecipientEmail: string;
  canaryUrl: string;
  cloudTrailLogRetention: number;
  datastore: {
    backupRetentionDays: number;
    monthlyBackupRetentionDays: number;
  };
  appService: {
    cpu: number;
    memory: number;
  };
  webAclArn?: string;
  github: {
    organization: string;
    repositories: string[];
  };
  examineeId: string;
}

export class Ec2Stack extends Stack {
  constructor(scope: Construct, id: string, props: Ec2StackProps) {
    super(scope, id, props);

    // 共通で使用するKMSキーを作成
    const cmk = new Key(this, "CMK", {
      enableKeyRotation: true,
      description: "CMK for Ec2App",
      alias: Names.uniqueResourceName(this, {}),
    });

    // 共通のS3アクセスログバケットを作成
    const s3AccessLogBucket = new Bucket(this, "S3AccessLogBucket", {
      bucketName: `s3-access-logs-${props.env.account}`,
      encryption: BucketEncryption.S3_MANAGED,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_PREFERRED,
      lifecycleRules: [
        {
          id: "DeleteOldAccessLogs",
          enabled: true,
          expiration: Duration.days(props.bucketLogRetention),
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY, // TODO: 確定したらRETAINに変更
      enforceSSL: true,
    });

    // ネットワーキングの設定（VPC、サブネット、NATゲートウェイなど）
    const networking = new Networking(this, "Networking", {
      vpcCidr: props.vpcCidr,
      maxAzs: props.maxAzs,
      natGateways: props.natGateways,
      s3AccessLogBucket: s3AccessLogBucket,
    });

    // データストアの設定（RDS/Aurora）
    const datastore = new Datastore(this, "Datastore", {
      vpc: networking.vpc,
      cmk: cmk,
      env: props.env,
      parameter: {
        datastore: props.datastore,
      } as EnvironmentParameter,
    });

    // DNS構成（Route53とACM証明書）
    const dns = new Dns(this, "Dns", {
      domainName: props.domainName,
    });

    // ロードバランサーの設定
    const loadBalancer = new LoadBalancer(this, "LoadBalancer", {
      vpc: networking.vpc,
      bucketLogRetention: props.bucketLogRetention,
      albCertificate: dns.albCertificate,
      s3AccessLogBucket: s3AccessLogBucket,
      env: props.env,
    });

    // CloudFront WAFのARNをプロパティから取得
    const cloudfrontWebAclArn = props.webAclArn;

    // フロントエンドの設定
    const frontend = new Frontend(this, "Frontend", {
      bucketLogRetention: props.bucketLogRetention,
      publicAlb: loadBalancer.publicAlb,
      cloudfrontWebAclArn: cloudfrontWebAclArn,
      domainName: props.domainName,
      cloudfrontCertificate: props.cloudfrontCertificate,
      s3AccessLogBucket: s3AccessLogBucket,
    });

    // EC2アプリケーションの設定
    const ec2App = new Ec2App(this, "Ec2App", {
      vpc: networking.vpc,
      cmk: cmk,
      publicAlbListener: loadBalancer.publicAlbListener,
      cloudWatchLogsRetention: props.cloudWatchLogsRetention,
      s3StaticSiteBucket: frontend.staticSiteBucket,
      dbCluster: datastore.dbCluster,
      examineeId: props.examineeId,
    });

    // CloudTrailの設定
    const cloudTrail = new CloudTrail(this, "CloudTrail", {
      cmk: cmk,
      cloudTrailLogRetention: props.cloudTrailLogRetention,
      s3AccessLogBucket: s3AccessLogBucket,
      env: props.env,
    });

    // 監視機能の設定
    const monitoring = new Monitoring(this, "Monitoring", {
      appLogGroup: ec2App.appLogGroup,
      notificationRecipientEmail: props.notificationRecipientEmail,
      autoScalingGroup: ec2App.appAsg,
      cloudTrailLogGroup: cloudTrail.cloudWatchLogGroup,
      env: props.env,
    });

    // Canary外形監視の設定
    new Canary(this, "Canary", {
      canaryUrl: props.canaryUrl,
      snsTopic: monitoring.snsTopic,
      s3AccessLogBucket: s3AccessLogBucket,
    });

    // Route53レコードの作成
    dns.createDnsRecords(
      frontend.distribution,
      props.domainName
    );

    // GuardDuty setup
    new GuardDuty(this, "GuardDuty", {
      notificationRecipientEmail: props.notificationRecipientEmail,
    });

    // AWS Config setup
    new AwsConfig(this, "AwsConfig", {
      bucketLogRetention: props.bucketLogRetention,
    });

    // ElastiCache Redisの設定
    const elasticache = new ElastiCache(this, "ElastiCache", {
      vpc: networking.vpc,
      appSg: ec2App.appServerSecurityGroup,
    });
    elasticache.redisEndpointParameter.grantRead(ec2App.appAsg.role);

    // バッチの設定
    new Batch(this, "Batch", {
      vpc: networking.vpc,
      env: props.env,
      dbCluster: datastore.dbCluster,
    });

    // CodeDeployの設定
    const codedeploy = new CodeDeploy(this, "CodeDeploy", {
      description: props.description,
      asg: ec2App.appAsg,
    });

    // GitHub Actions OIDC設定
    new GitHubOidc(this, "GitHubOidc", {
      githubOrganization: props.github.organization,
      githubRepositories: props.github.repositories,
      staticSiteBucket: frontend.staticSiteBucket,
      deployBucket: codedeploy.deployBucket,
      cloudfrontDistribution: frontend.distribution,
      env: props.env,
    });
  }
}
