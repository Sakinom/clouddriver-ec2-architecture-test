import {
  aws_kms as kms,
  aws_rds as rds,
  aws_ec2 as ec2,
  aws_backup as backup,
  aws_events as events,
  aws_iam as iam,
  RemovalPolicy,
  Duration,
} from 'aws-cdk-lib';
import { IDatabaseCluster } from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { EnvironmentParameter } from '../../parameter';

export interface DatastoreProps {
  vpc: ec2.IVpc;
  cmk: kms.IKey;
  env: {
    account: string;
    region: string;
  };
  parameter: EnvironmentParameter;
}

export class Datastore extends Construct {
  public readonly dbCluster: IDatabaseCluster;
  public readonly dbSecret: ISecret;

  constructor(scope: Construct, id: string, props: DatastoreProps) {
    super(scope, id);

    // Aurora MySQL用のセキュリティグループ
    const rdsSg = new ec2.SecurityGroup(this, 'RdsSg', {
      securityGroupName: `datastore-aurora-sg-${props.env.account}`,
      vpc: props.vpc,
      allowAllOutbound: true,
    });

    // Aurora MySQLのパラメータグループ
    const parameterGroup = new rds.ParameterGroup(this, 'ParameterGroup', {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_11_0,
      }),
      parameters: {
        'time_zone': 'Asia/Tokyo',
      },
    });

    // Aurora MySQL クラスターの作成
    const cluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      clusterIdentifier: `datastore-aurora-cluster-${props.env.account}`,
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_11_0,
      }),
      parameterGroup: parameterGroup,
      credentials: rds.Credentials.fromGeneratedSecret('dbadmin'),
      writer: rds.ClusterInstance.provisioned('Instance1', {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
        instanceIdentifier: `datastore-aurora-instance-${props.env.account}`,
        enablePerformanceInsights: false,
      }),
      readers: [
        rds.ClusterInstance.provisioned('ReaderInstance1', {
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
          instanceIdentifier: `datastore-aurora-reader-instance-${props.env.account}`,
          enablePerformanceInsights: false,
        }),
      ],
      vpc: props.vpc,
      removalPolicy: RemovalPolicy.RETAIN,
      defaultDatabaseName: `db_${props.env.account}`,
      storageEncrypted: true,
      storageEncryptionKey: props.cmk,
      securityGroups: [rdsSg],
      backup: {
        retention: Duration.days(props.parameter.datastore.backupRetentionDays),
      },
    });
    this.dbCluster = cluster;
    if (!cluster.secret) throw new Error('cluster.secret is undefined');
    this.dbSecret = cluster.secret;

    // Auroraリーダーレプリカの自動スケーリング設定
    // const scalableTarget = new autoscaling.ScalableTarget(this, 'ReaderAutoScalingTarget', {
    //   serviceNamespace: autoscaling.ServiceNamespace.RDS,
    //   scalableDimension: 'rds:cluster:ReadReplicaCount',
    //   resourceId: `cluster:${cluster.clusterIdentifier}`,
    //   minCapacity: 1,
    //   maxCapacity: 4,
    // });
    // scalableTarget.node.addDependency(cluster);

    // scalableTarget.scaleToTrackMetric('ReaderCpuScaling', {
    //   targetValue: 80,
    //   predefinedMetric: autoscaling.PredefinedMetric.RDS_READER_AVERAGE_CPU_UTILIZATION,
    //   scaleInCooldown: Duration.seconds(300),
    //   scaleOutCooldown: Duration.seconds(300),
    // });

    // AWS Backup用のサービスロール
    const backupRole = new iam.Role(this, 'BackupRole', {
      roleName: `backup-role-${props.env.account}`,
      assumedBy: new iam.ServicePrincipal('backup.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSBackupServiceRolePolicyForBackup'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSBackupServiceRolePolicyForRestores'),
      ],
    });

    // Backup Vault（バックアップ保管庫）
    const backupVault = new backup.BackupVault(this, 'BackupVault', {
      backupVaultName: `backup-vault-${props.env.account}`,
      encryptionKey: props.cmk,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Backup Plan（バックアップ計画）
    const backupPlan = new backup.BackupPlan(this, 'BackupPlan', {
      backupPlanName: `backup-plan-${props.env.account}`,
      backupVault: backupVault,
    });

    // Backup Plan Rule（月次バックアップルール）
    backupPlan.addRule(new backup.BackupPlanRule({
      ruleName: 'MonthlyBackup',
      scheduleExpression: events.Schedule.expression('cron(0 16 L * ? *)'), // 毎月最終日のUTC 16:00 = 翌月1日のJST 01:00
      deleteAfter: Duration.days(props.parameter.datastore.monthlyBackupRetentionDays),
    }));

    // Backup Selection（バックアップ対象の選択）
    new backup.BackupSelection(this, 'BackupSelection', {
      backupPlan: backupPlan,
      backupSelectionName: `aurora-selection-${props.env.account}`,
      role: backupRole,
      resources: [
        backup.BackupResource.fromArn(cluster.clusterArn),
      ],
    });
  }
}
