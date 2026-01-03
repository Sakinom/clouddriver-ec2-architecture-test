import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { aws_ec2 as ec2 } from 'aws-cdk-lib';
import { aws_elasticloadbalancingv2 as elbv2 } from 'aws-cdk-lib';
import { aws_iam as iam } from 'aws-cdk-lib';
import { aws_kms as kms } from 'aws-cdk-lib';
import { aws_autoscaling as autoscaling } from 'aws-cdk-lib';
import { aws_ssm as ssm } from 'aws-cdk-lib';
import { aws_logs as logs } from 'aws-cdk-lib';

export interface Ec2AppProps {
  vpc: ec2.IVpc;
  cmk: kms.IKey;
  publicAlbListener: elbv2.ApplicationListener;
  cloudWatchLogsRetention: logs.RetentionDays;
}

export class Ec2App extends Construct {
  public readonly appServerSecurityGroup: ec2.ISecurityGroup;
  public readonly appAsg: autoscaling.IAutoScalingGroup;
  public readonly appLogGroup: logs.ILogGroup;

  constructor(scope: Construct, id: string, props: Ec2AppProps) {
    super(scope, id);

    // --- Security Groups ---

    //Security Group for Instance of App
    const appSg = new ec2.SecurityGroup(this, 'AppSg', {
      vpc: props.vpc,
      allowAllOutbound: false,
    });
    appSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.allTcp());
    this.appServerSecurityGroup = appSg;

    // ------------ CloudWatch Log Group ---------------

    const appLogGroup = new logs.LogGroup(this, 'HttpdErrorLogGroup', {
      logGroupName: '/ec2/app/httpd/error',
      retention: props.cloudWatchLogsRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.appLogGroup = appLogGroup;

    // ------------ AppServers (Ec2.Instance) ---------------

    // InstanceProfile for AppServers
    const ssmInstanceRole = new iam.Role(this, 'SsmInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      path: '/',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });
    const cwAgentConfig = new ssm.StringParameter(this, 'CwAgentConfig', {
      parameterName: '/cloudwatch/agent/ec2/app',
      stringValue: JSON.stringify({
        logs: {
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
    cwAgentConfig.grantRead(ssmInstanceRole);

    // UserData for AppServer (install Apache and set index.html)
    const userdata = ec2.UserData.forLinux({ shebang: '#!/bin/bash' });
    userdata.addCommands(
      'sudo yum -y install httpd',
      'sudo systemctl enable httpd',
      'sudo systemctl start httpd',
      'echo "<h1>Hello from $(hostname)</h1>" > /var/www/html/index.html',
      'chown apache.apache /var/www/html/index.html',
    );
    userdata.addCommands(
      'sudo yum -y install amazon-cloudwatch-agent',
      'sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c ssm:/cloudwatch/agent/ec2/app -s',
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
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
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
      role: ssmInstanceRole,
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
