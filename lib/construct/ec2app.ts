import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { aws_ec2 as ec2 } from 'aws-cdk-lib';
import { aws_elasticloadbalancingv2 as elbv2 } from 'aws-cdk-lib';
import { aws_iam as iam } from 'aws-cdk-lib';
import { aws_kms as kms } from 'aws-cdk-lib';
import { aws_autoscaling as autoscaling } from 'aws-cdk-lib';
import { aws_ssm as ssm } from 'aws-cdk-lib';
import { aws_logs as logs } from 'aws-cdk-lib';
import { aws_s3 as s3 } from 'aws-cdk-lib';
import { aws_rds as rds } from 'aws-cdk-lib';

export interface Ec2AppProps {
  vpc: ec2.IVpc;
  cmk: kms.IKey;
  publicAlbListener: elbv2.ApplicationListener;
  cloudWatchLogsRetention: logs.RetentionDays;
  s3StaticSiteBucket: s3.IBucket;
  dbCluster: rds.IDatabaseCluster;
  examineeId: string;
}

export class Ec2App extends Construct {
  public readonly appServerSecurityGroup: ec2.ISecurityGroup;
  public readonly appAsg: autoscaling.AutoScalingGroup;
  public readonly appLogGroup: logs.ILogGroup;

  constructor(scope: Construct, id: string, props: Ec2AppProps) {
    super(scope, id);

    // --- Security Groups ---

    // Security Group for Instance of App
    const appSg = new ec2.SecurityGroup(this, 'AppSg', {
      vpc: props.vpc,
      allowAllOutbound: false,
    });
    appSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.allTcp());
    this.appServerSecurityGroup = appSg;

    // EC2アプリケーションにDB接続情報を付与
    props.dbCluster.connections.allowDefaultPortFrom(appSg);

    // ------------ CloudWatch Log Group ---------------

    const appLogGroup = new logs.LogGroup(this, 'HttpdErrorLogGroup', {
      logGroupName: '/ec2/app/httpd/error',
      retention: props.cloudWatchLogsRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.appLogGroup = appLogGroup;

    // ------------ AppServers (Ec2.Instance) ---------------

    // InstanceProfile for AppServers
    const instanceRole = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      path: '/',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess'),
      ],
    });

    // Grant read access to S3 Static Site Bucket
    props.s3StaticSiteBucket.grantReadWrite(instanceRole);

    const cwAgentConfig = new ssm.StringParameter(this, 'CwAgentConfig', {
      parameterName: '/cloudwatch/agent/ec2/app',
      stringValue: JSON.stringify({
        metrics: {
          append_dimensions: {
            InstanceId: "${aws:InstanceId}"
          },
          metrics_collected: {
            mem: {
              measurement: [
                "mem_used_percent", // メモリ使用率
                "mem_total",        // 合計メモリ
                "mem_used"          // 使用済みメモリ
              ],
              metrics_collection_interval: 60
            }
          }
        },
        logs: {
          force_flush_interval: 5,
          logs_collected: {
            files: {
              collect_list: [
                {
                  file_path: '/var/log/httpd/access_log',
                  log_group_name: '/ec2/app/httpd/access',
                  log_stream_name: '{instance_id}',
                },
                {
                  file_path: '/var/log/httpd/error_log',
                  log_group_name: '/ec2/app/httpd/error',
                  log_stream_name: '{instance_id}',
                },
              ],
            },
          },
        },
      }),
    });
    cwAgentConfig.grantRead(instanceRole);

    // UserData for AppServer (install Apache and set index.html)
    const userdata = ec2.UserData.forLinux({ shebang: '#!/bin/bash' });

    // Parameters for initialize.sh
    const dbHostWriter = props.dbCluster.clusterEndpoint.hostname;
    const dbHostReader = props.dbCluster.clusterReadEndpoint.hostname;
    /* 以下で対応できなかったため、テストにつき安全ではない方法を使用
    - const dbUser = props.dbSecret.secretValueFromJson('username').unsafeUnwrap();
    - const dbPass = props.dbSecret.secretValueFromJson('password').unsafeUnwrap();
    */
    const dbUser = 'dbadmin';
    const dbPass = 'KynBA92.y1AtgN=0qxlugrLh8LKCOa';
    const examineeId = props.examineeId;

    // Quit nginx if installed
    userdata.addCommands(
      'sudo systemctl stop nginx',
      'sudo systemctl disable nginx',
    );
    // Install Apache HTTP Server
    userdata.addCommands(
      'sudo dnf -y install httpd',
      'sudo systemctl enable httpd',
      'sudo systemctl start httpd',
    );
    // Install and configure CloudWatch Agent
    userdata.addCommands(
      'sudo dnf -y install amazon-cloudwatch-agent',
      'sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c ssm:/cloudwatch/agent/ec2/app -s',
    );
    // Set Environment Variables
    userdata.addCommands(
      `echo "export REDIS_ENDPOINT=$(aws ssm get-parameter --name '/app/redis/endpoint' --query 'Parameter.Value' --output text --region ${cdk.Stack.of(this).region})" >> /etc/profile.d/my_env.sh`,
      `echo "export BUCKET_NAME=${props.s3StaticSiteBucket.bucketName}" >> /etc/profile.d/my_env.sh`,
      `source /etc/profile.d/my_env.sh`
    );
    // Install CodeDeploy Agent
    userdata.addCommands(
      'sudo dnf -y install ruby wget',
      'cd /home/ec2-user',
      'wget https://aws-codedeploy-' + cdk.Stack.of(this).region + '.s3.amazonaws.com/latest/install',
      'chmod +x ./install',
      'sudo ./install auto',
      'sudo systemctl start codedeploy-agent',
      'sudo systemctl enable codedeploy-agent',
    );
    userdata.addCommands(
      `cat <<EOF > /var/lib/cloud/scripts/per-boot/initialize_db.sh`,
      `#!/bin/bash`,
      `/home/ec2-user/initialize.sh ${dbHostWriter} ${dbHostReader} ${dbUser} ${dbPass} ${examineeId}`,
      `EOF`,

      `chmod +x /var/lib/cloud/scripts/per-boot/initialize_db.sh`,
      `/var/lib/cloud/scripts/per-boot/initialize_db.sh`,
      `sudo sed -i 's|"/var/www/html"|"/opt/clouddriver"|g' /etc/httpd/conf/httpd.conf`,
      `sudo sed -i 's|<Directory "/var/www">|<Directory "/opt/clouddriver">|g' /etc/httpd/conf/httpd.conf`,
      `sudo sed -i 's/DirectoryIndex index.html/DirectoryIndex index.php index.html/g' /etc/httpd/conf/httpd.conf`,

      `cat <<EOF > /etc/httpd/conf.d/rewrite_html.conf`,
      `<Directory "/opt/clouddriver">`,
      `    RewriteEngine On`,
      `    RewriteRule ^index\\.html$ index.php [L]`,
      `</Directory>`,
      `EOF`,

      `sudo chown -R apache:apache /opt/clouddriver`,
      `sudo systemctl restart httpd`,
    );

    // ------------ AppServers (AutoScaling) ---------------

    // Auto Scaling Group for AppServers
    const appAsg = new autoscaling.AutoScalingGroup(this, 'AppAsg', {
      minCapacity: 2,
      maxCapacity: 4,
      vpc: props.vpc,
      vpcSubnets: props.vpc.selectSubnets({
        subnetGroupName: 'Private',
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      machineImage: ec2.MachineImage.genericLinux({
        [cdk.Stack.of(this).region]: 'ami-064e45c10b48b8151',
      }),
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: autoscaling.BlockDeviceVolume.ebs(10, {
            encrypted: true,
          }),
        },
      ],
      securityGroup: appSg,
      role: instanceRole,
      userData: userdata,
      healthChecks: autoscaling.HealthChecks.ec2({
        gracePeriod: cdk.Duration.minutes(5),
      }),
    });
    this.appAsg = appAsg;

    // AutoScaling Policy
    appAsg.scaleOnCpuUtilization('keepSpareCPU', {
      targetUtilizationPercent: 80,
    });

    // Tags for AppServers
    cdk.Tags.of(appAsg).add('Name', 'AppServer', { applyToLaunchedInstances: true });

    // Add targets from AutoScaling Group and static EC2 instances
    props.publicAlbListener.addTargets('AppAsgTarget', {
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 80,
      targets: [appAsg],
      deregistrationDelay: cdk.Duration.seconds(30),
    });
  }
}
