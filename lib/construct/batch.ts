import { Construct } from 'constructs';
import { TimeZone } from "aws-cdk-lib";
import { aws_scheduler_targets as targets } from "aws-cdk-lib";
import { Schedule, ScheduleExpression, ScheduleTargetInput } from "aws-cdk-lib/aws-scheduler";
import { aws_s3 as s3, RemovalPolicy } from "aws-cdk-lib";
import { aws_ec2 as ec2 } from 'aws-cdk-lib';
import { IDatabaseCluster } from 'aws-cdk-lib/aws-rds';
import { aws_iam as iam } from 'aws-cdk-lib';
import * as cdk from 'aws-cdk-lib';

export interface BatchProps {
  vpc: ec2.IVpc;
  env: {
    account: string;
    region: string;
  };
  dbCluster: IDatabaseCluster;
}

export class Batch extends Construct {
  constructor(scope: Construct, id: string, props: BatchProps) {
    super(scope, id);

    const outputBucket = new s3.Bucket(this, "OutputBucket", {
      bucketName: `batch-outputs-${props.env.account}`,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const batchInstanceSg = new ec2.SecurityGroup(this, "LambdaSg", {
      vpc: props.vpc,
      allowAllOutbound: true,
    });

    const instanceRole = new cdk.aws_iam.Role(this, "BatchEC2Role", {
      assumedBy: new cdk.aws_iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });
    // S3バケットへの読み書き権限を付与
    outputBucket.grantReadWrite(instanceRole);

    const userdata = ec2.UserData.forLinux({ shebang: '#!/bin/bash' });

    // Parameters for initialize.sh
    const dbHostReader = props.dbCluster.clusterReadEndpoint.hostname;
    /* 以下で対応できなかったため、テストにつき安全ではない方法を使用
    - const dbUser = props.dbSecret.secretValueFromJson('username').unsafeUnwrap();
    - const dbPass = props.dbSecret.secretValueFromJson('password').unsafeUnwrap();
    */
    const dbUser = 'dbadmin';
    const dbPass = 'KynBA92.y1AtgN=0qxlugrLh8LKCOa';

    userdata.addCommands(
      `mkdir -p /opt/engineed-batch/result`,
      `cp /home/ec2-user/batch_process.py /opt/engineed-batch/`,
      `cat <<EOF > /var/lib/cloud/scripts/per-boot/initialize_db.sh`,
      `#!/bin/bash`,
      `/home/ec2-user/initialize.sh ${dbHostReader} ${dbUser} ${dbPass}`,
      `EOF`,
      `chmod +x /var/lib/cloud/scripts/per-boot/initialize_db.sh`,
      `/var/lib/cloud/scripts/per-boot/initialize_db.sh`,
      `chmod +x /opt/engineed-batch/batch_process.py`
    );

    const batchInstance = new ec2.Instance(this, "BatchInstance", {
      vpc: props.vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      machineImage: ec2.MachineImage.genericLinux({
        [props.env.region]: "ami-07436a8e124009f5b",
      }),
      securityGroup: batchInstanceSg,
      role: instanceRole,
    });

    // database cluster に対して、バッチサーバからのアクセスを許可する
    props.dbCluster.connections.allowDefaultPortFrom(batchInstanceSg);

    // SSM Run Command用のIAMロールを作成
    const schedulerRole = new iam.Role(this, "SchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
    });

    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:SendCommand"],
        resources: [
          `arn:aws:ssm:${props.env.region}:${props.env.account}:document/AWS-RunShellScript`,
          `arn:aws:ec2:${props.env.region}:${props.env.account}:instance/*`,
        ],
      })
    );

    const target = new targets.Universal({
      service: "ssm",
      action: "sendCommand",
      input: ScheduleTargetInput.fromObject({
        InstanceIds: [batchInstance.instanceId],
        DocumentName: "AWS-RunShellScript",
        Parameters: {
          commands: [
            `python3.12 /opt/engineed-batch/batch_process.py --s3-bucket ${outputBucket.bucketName}`,
          ],
        },
      }),
      role: schedulerRole,
    });

    new Schedule(this, "DailyBatchSchedule", {
      schedule: ScheduleExpression.cron({
        minute: "0",
        hour: "1",
        day: "*",
        month: "*",
        year: "*",
        timeZone: TimeZone.ASIA_TOKYO,
      }),
      target: target,
      description: "Daily at 1 AM Tokyo time",
    });
  }
}
