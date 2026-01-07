import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { TimeZone } from "aws-cdk-lib";
import { aws_scheduler_targets as targets } from "aws-cdk-lib";
import { Schedule, ScheduleExpression } from "aws-cdk-lib/aws-scheduler";
import { aws_lambda as lambda } from "aws-cdk-lib";
import { aws_s3 as s3, RemovalPolicy } from "aws-cdk-lib";
import path from "path";

export interface BatchStackProps extends StackProps {
  description: string;
  env: {
    account: string;
    region: string;
  };
}

export class BatchStack extends Stack {
  constructor(scope: Construct, id: string, props: BatchStackProps) {
    super(scope, id, props);

    const outputBucket = new s3.Bucket(this, "OutputBucket", {
      bucketName: `batch-output-bucket-${props.env.account}`,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const batchFunction = new lambda.Function(this, "BatchFunction", {
      handler: "index.handler",
      runtime: lambda.Runtime.PYTHON_3_13,
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/batch")),
      environment: {
        OUTPUT_BUCKET_NAME: outputBucket.bucketName,
      },
    });
    outputBucket.grantWrite(batchFunction);

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
