import * as cdk from "aws-cdk-lib";
import {
  aws_sns as sns,
  aws_sns_subscriptions as subs,
  aws_logs as cwl,
  aws_cloudwatch as cw,
  aws_cloudwatch_actions as cw_actions,
  aws_autoscaling as autoscaling,
} from "aws-cdk-lib";
import { Construct } from "constructs";

export interface MonitoringProps {
  appLogGroup: cwl.ILogGroup;
  notificationRecipientEmail: string;
  autoScalingGroup: autoscaling.IAutoScalingGroup;
  cloudTrailLogGroup?: cwl.ILogGroup;
  env: {
    account: string;
    region: string;
  };
}

export class Monitoring extends Construct {
  public readonly snsTopic: sns.Topic;
  public readonly metricFilter: cwl.MetricFilter;
  public readonly errorAlarm: cw.Alarm;
  public readonly appCpuAlarm: cw.Alarm;
  public readonly appMemoryAlarm: cw.Alarm;
  public readonly mfaConsoleLoginMetricFilter?: cwl.MetricFilter;
  public readonly mfaConsoleLoginAlarm?: cw.Alarm;
  public readonly rootAccountUsageMetricFilter?: cwl.MetricFilter;
  public readonly rootAccountUsageAlarm?: cw.Alarm;
  public readonly iamPolicyChangeMetricFilter?: cwl.MetricFilter;
  public readonly iamPolicyChangeAlarm?: cw.Alarm;
  public readonly consoleAuthFailureMetricFilter?: cwl.MetricFilter;
  public readonly consoleAuthFailureAlarm?: cw.Alarm;
  public readonly s3BucketPolicyChangeMetricFilter?: cwl.MetricFilter;
  public readonly s3BucketPolicyChangeAlarm?: cw.Alarm;

  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);

    // SNSトピックの作成
    this.snsTopic = new sns.Topic(this, "ErrorNotificationTopic", {
      topicName: 'error-notification',
      displayName: 'Error Notification',
    });

    // メール購読の追加
    this.snsTopic.addSubscription(
      new subs.EmailSubscription(props.notificationRecipientEmail)
    );

    // CloudWatch Logsメトリクスフィルターの作成
    this.metricFilter = new cwl.MetricFilter(this, "ErrorMetricFilter", {
      logGroup: props.appLogGroup,
      metricNamespace: 'Application',
      metricName: "ErrorCount",
      filterPattern: cwl.FilterPattern.literal(
        '[timestamp, request_id, level="ERROR", ...]'
      ),
      metricValue: "1",
      defaultValue: 0,
    });

    // エラーログアラームの作成
    this.errorAlarm = new cw.Alarm(this, "ErrorAlarm", {
      alarmName:'error-alarm',
      alarmDescription: 'Error detected in application logs',
      metric: this.metricFilter.metric({
        statistic: "Sum",
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    });

    // AppサービスのCPU利用率アラーム
    this.appCpuAlarm = new cw.Alarm(this, "AppCpuAlarm", {
      alarmName: `app-cpu-alarm`,
      alarmDescription: `App service CPU utilization over 70%`,
      metric: new cw.Metric({
        namespace: "AWS/EC2",
        metricName: "CPUUtilization",
        dimensionsMap: {
          InstanceId: props.autoScalingGroup.autoScalingGroupName,
        },
        statistic: "Average",
        period: cdk.Duration.minutes(5),
      }),
      threshold: 70,
      evaluationPeriods: 2,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    });

    // AppサービスのMemory利用率アラーム
    this.appMemoryAlarm = new cw.Alarm(this, "AppMemoryAlarm", {
      alarmName: `app-memory-alarm`,
      alarmDescription: `App service Memory utilization over 70%`,
      metric: new cw.Metric({
        namespace: "AWS/ECS",
        metricName: "MemoryUtilization",
        dimensionsMap: {
          InstanceId: props.autoScalingGroup.autoScalingGroupName,
        },
        statistic: "Average",
        period: cdk.Duration.minutes(5),
      }),
      threshold: 70,
      evaluationPeriods: 2,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    });

        // MFA未使用のコンソールログイン検出（CloudTrailログが提供されている場合）
        if (props.cloudTrailLogGroup) {
          // メトリクスフィルターの作成
          this.mfaConsoleLoginMetricFilter = new cwl.MetricFilter(
            this,
            "MfaConsoleLoginMetricFilter",
            {
              logGroup: props.cloudTrailLogGroup,
              metricNamespace: `Security`,
              metricName: "ConsoleLoginWithoutMFA",
              filterPattern: cwl.FilterPattern.literal(
                '{ ($.eventName = "ConsoleLogin") && ($.additionalEventData.MFAUsed != "Yes") }'
              ),
              metricValue: "1",
              defaultValue: 0,
            }
          );

          // アラームの作成
          this.mfaConsoleLoginAlarm = new cw.Alarm(
            this,
            "MfaConsoleLoginAlarm",
            {
              alarmName: `console-login-without-mfa`,
              alarmDescription: `Console login without MFA detected`,
              metric: this.mfaConsoleLoginMetricFilter.metric({
                statistic: "Sum",
                period: cdk.Duration.minutes(5),
              }),
              threshold: 1,
              evaluationPeriods: 1,
              comparisonOperator:
                cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
              treatMissingData: cw.TreatMissingData.NOT_BREACHING,
            }
          );

          // SNSアクションを設定
          this.mfaConsoleLoginAlarm.addAlarmAction(
            new cw_actions.SnsAction(this.snsTopic)
          );

          // タグの追加
          cdk.Tags.of(this.mfaConsoleLoginAlarm).add(
            "Name",
            `console-login-without-mfa-alarm`
          );

      // rootアカウント利用検出
      this.rootAccountUsageMetricFilter = new cwl.MetricFilter(
        this,
        "RootAccountUsageMetricFilter",
        {
          logGroup: props.cloudTrailLogGroup,
          metricNamespace: `Security`,
          metricName: "RootAccountUsage",
          filterPattern: cwl.FilterPattern.literal(
            '{ $.userIdentity.type = "Root" && $.userIdentity.invokedBy NOT EXISTS && $.eventType != "AwsServiceEvent" }'
          ),
          metricValue: "1",
          defaultValue: 0,
        }
      );

      // アラームの作成
      this.rootAccountUsageAlarm = new cw.Alarm(
        this,
        "RootAccountUsageAlarm",
        {
          alarmName: `root-account-usage`,
          alarmDescription: `Root account usage detected`,
          metric: this.rootAccountUsageMetricFilter.metric({
            statistic: "Sum",
            period: cdk.Duration.minutes(5),
          }),
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator:
            cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          treatMissingData: cw.TreatMissingData.NOT_BREACHING,
        }
      );

      // SNSアクションを設定
      this.rootAccountUsageAlarm.addAlarmAction(
        new cw_actions.SnsAction(this.snsTopic)
      );

      // タグの追加
      cdk.Tags.of(this.rootAccountUsageAlarm).add(
        "Name",
        `root-account-usage-alarm`
      );

      // IAMポリシー・パスワードポリシー・MFA設定の変更検出
      this.iamPolicyChangeMetricFilter = new cwl.MetricFilter(
        this,
        "IamPolicyChangeMetricFilter",
        {
          logGroup: props.cloudTrailLogGroup,
          metricNamespace: `Security`,
          metricName: "IAMPolicyChange",
          filterPattern: cwl.FilterPattern.literal(
            '{($.eventName=DeleteGroupPolicy)||($.eventName=DeleteRolePolicy)||($.eventName=DeleteUserPolicy)||($.eventName=PutGroupPolicy)||($.eventName=PutRolePolicy)||($.eventName=PutUserPolicy)||($.eventName=CreatePolicy)||($.eventName=DeletePolicy)||($.eventName=CreatePolicyVersion)||($.eventName=DeletePolicyVersion)||($.eventName=AttachRolePolicy)||($.eventName=DetachRolePolicy)||($.eventName=AttachUserPolicy)||($.eventName=DetachUserPolicy)||($.eventName=AttachGroupPolicy)||($.eventName=DetachGroupPolicy)||($.eventName=ChangePassword)||($.eventName=DeleteAccountPasswordPolicy)||($.eventName=UpdateAccountPasswordPolicy)||($.eventName=DeactivateMFADevice)||($.eventName=DeleteVirtualMFADevice)||($.eventName=ResyncMFADevice)||($.eventName=EnableMFADevice)||($.eventName=CreateVirtualMFADevice)}'
          ),
          metricValue: "1",
          defaultValue: 0,
        }
      );

      // アラームの作成
      this.iamPolicyChangeAlarm = new cw.Alarm(
        this,
        "IamPolicyChangeAlarm",
        {
          alarmName: `iam-policy-change`,
          alarmDescription: `IAM policy, password policy, or MFA configuration change detected`,
          metric: this.iamPolicyChangeMetricFilter.metric({
            statistic: "Sum",
            period: cdk.Duration.minutes(5),
          }),
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator:
            cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          treatMissingData: cw.TreatMissingData.NOT_BREACHING,
        }
      );

      // SNSアクションを設定
      this.iamPolicyChangeAlarm.addAlarmAction(
        new cw_actions.SnsAction(this.snsTopic)
      );

      // タグの追加
      cdk.Tags.of(this.iamPolicyChangeAlarm).add(
        "Name",
        `iam-policy-change-alarm`
      );

      // コンソール認証ミス検出
      this.consoleAuthFailureMetricFilter = new cwl.MetricFilter(
        this,
        "ConsoleAuthFailureMetricFilter",
        {
          logGroup: props.cloudTrailLogGroup,
          metricNamespace: `Security`,
          metricName: "ConsoleAuthenticationFailure",
          filterPattern: cwl.FilterPattern.literal(
            '{ ($.eventName = ConsoleLogin) && ($.errorMessage = "Failed authentication") }'
          ),
          metricValue: "1",
          defaultValue: 0,
        }
      );

      // アラームの作成
      this.consoleAuthFailureAlarm = new cw.Alarm(
        this,
        "ConsoleAuthFailureAlarm",
        {
          alarmName: `console-auth-failure`,
          alarmDescription: `Console authentication failure detected`,
          metric: this.consoleAuthFailureMetricFilter.metric({
            statistic: "Sum",
            period: cdk.Duration.minutes(5),
          }),
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator:
            cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          treatMissingData: cw.TreatMissingData.NOT_BREACHING,
        }
      );

      // SNSアクションを設定
      this.consoleAuthFailureAlarm.addAlarmAction(
        new cw_actions.SnsAction(this.snsTopic)
      );

      // タグの追加
      cdk.Tags.of(this.consoleAuthFailureAlarm).add(
        "Name",
        `console-auth-failure-alarm`
      );

      // S3バケット設定変更検出
      this.s3BucketPolicyChangeMetricFilter = new cwl.MetricFilter(
        this,
        "S3BucketPolicyChangeMetricFilter",
        {
          logGroup: props.cloudTrailLogGroup,
          metricNamespace: `Security`,
          metricName: "S3BucketPolicyChange",
          filterPattern: cwl.FilterPattern.literal(
            '{ ($.eventSource = s3.amazonaws.com) && (($.eventName = PutBucketAcl) || ($.eventName = PutBucketPolicy) || ($.eventName = PutBucketCors) || ($.eventName = PutBucketLifecycle) || ($.eventName = PutBucketReplication) || ($.eventName = DeleteBucketPolicy) || ($.eventName = DeleteBucketCors) || ($.eventName = DeleteBucketLifecycle) || ($.eventName = DeleteBucketReplication)) }'
          ),
          metricValue: "1",
          defaultValue: 0,
        }
      );

      // アラームの作成
      this.s3BucketPolicyChangeAlarm = new cw.Alarm(
        this,
        "S3BucketPolicyChangeAlarm",
        {
          alarmName: `s3-bucket-policy-change`,
          alarmDescription: `S3 bucket policy or configuration change detected`,
          metric: this.s3BucketPolicyChangeMetricFilter.metric({
            statistic: "Sum",
            period: cdk.Duration.minutes(5),
          }),
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator:
            cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          treatMissingData: cw.TreatMissingData.NOT_BREACHING,
        }
      );

      // SNSアクションを設定
      this.s3BucketPolicyChangeAlarm.addAlarmAction(
        new cw_actions.SnsAction(this.snsTopic)
      );

      // タグの追加
      cdk.Tags.of(this.s3BucketPolicyChangeAlarm).add(
        "Name",
        `s3-bucket-policy-change-alarm`
      );
    }

    // すべてのアラームにSNSアクションを設定
    const snsAction = new cw_actions.SnsAction(this.snsTopic);
    this.errorAlarm.addAlarmAction(snsAction);
    this.appCpuAlarm.addAlarmAction(snsAction);
    this.appMemoryAlarm.addAlarmAction(snsAction);

    // タグの追加
    cdk.Tags.of(this.snsTopic).add(
      "Name",
      `notification-topic`
    );
    cdk.Tags.of(this.errorAlarm).add(
      "Name",
      `error-alarm`
    );
    cdk.Tags.of(this.appCpuAlarm).add(
      "Name",
      `app-cpu-alarm`
    );
    cdk.Tags.of(this.appMemoryAlarm).add(
      "Name",
      `app-memory-alarm`
    );
  }
}
