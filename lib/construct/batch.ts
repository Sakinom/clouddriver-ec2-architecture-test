import { Construct } from 'constructs';
import { TimeZone } from "aws-cdk-lib";
import { aws_scheduler_targets as targets } from "aws-cdk-lib";
import { Schedule, ScheduleExpression } from "aws-cdk-lib/aws-scheduler";
import { aws_lambda as lambda } from "aws-cdk-lib";
import { aws_s3 as s3, RemovalPolicy } from "aws-cdk-lib";
import path from "path";
import { aws_ec2 as ec2 } from 'aws-cdk-lib';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { IDatabaseCluster } from 'aws-cdk-lib/aws-rds';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import * as cdk from 'aws-cdk-lib';

export interface BatchProps {
  vpc: ec2.IVpc;
  env: {
    account: string;
    region: string;
  };
  dbCluster: IDatabaseCluster;
  dbSecret: ISecret;
}

export class Batch extends Construct {
  constructor(scope: Construct, id: string, props: BatchProps) {
    super(scope, id);

    const outputBucket = new s3.Bucket(this, "OutputBucket", {
      bucketName: `batch-outputs-${props.env.account}`,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const lambdaSg = new ec2.SecurityGroup(this, "LambdaSg", {
      vpc: props.vpc,
      allowAllOutbound: true,
    });

    const batchFunction = new PythonFunction(this, "BatchFunction", {
      entry: path.join(__dirname, "../lambda/batch"),
      runtime: lambda.Runtime.PYTHON_3_13,
      index: "index.py",
      handler: "handler",
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [lambdaSg],
      timeout: cdk.Duration.seconds(30),
      environment: {
        OUTPUT_BUCKET_NAME: outputBucket.bucketName,
        DB_SECRET_ARN: props.dbSecret.secretArn,
      },
    });
    outputBucket.grantWrite(batchFunction);
    props.dbSecret.grantRead(batchFunction);

    // database cluster に対して、lambda からのアクセスを許可する
    props.dbCluster.connections.allowDefaultPortFrom(lambdaSg);

    const target = new targets.LambdaInvoke(batchFunction);

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
