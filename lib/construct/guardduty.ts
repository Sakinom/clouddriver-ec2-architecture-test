import { Construct } from 'constructs';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Rule, EventPattern } from 'aws-cdk-lib/aws-events';
import { SnsTopic } from 'aws-cdk-lib/aws-events-targets';

export interface GuardDutyProps {
  notificationRecipientEmail: string;
}

export class GuardDuty extends Construct {
  public readonly snsTopic: Topic;

  constructor(scope: Construct, id: string, props: GuardDutyProps) {
    super(scope, id);

    // SNS Topic for notifications
    this.snsTopic = new Topic(this, 'GuardDutyTopic', {
      topicName: `guardduty-notifications`,
      displayName: `GuardDuty Notifications`,
    });

    // Email subscription to SNS topic
    this.snsTopic.addSubscription(new EmailSubscription(props.notificationRecipientEmail));

    // EventBridge Rule for GuardDuty findings
    // 重要度が高い（MEDIUM以上）の検知のみを通知対象とする
    const guardDutyRule = new Rule(this, 'GuardDutyRule', {
      ruleName: `guardduty-findings`,
      description: 'Rule to capture GuardDuty findings and send notifications',
      eventPattern: {
        source: ['aws.guardduty'],
        detailType: ['GuardDuty Finding'],
        detail: {
          severity: [
            { 'numeric': ['>=', 9.0] },
          ],
        },
      } as EventPattern,
    });

    // Add SNS topic as target for the rule
    guardDutyRule.addTarget(new SnsTopic(this.snsTopic));

    // EventBridge Rule for GuardDuty service health issues
    const guardDutyHealthRule = new Rule(this, 'GuardDutyHealthRule', {
      ruleName: `guardduty-health`,
      description: 'Rule to capture GuardDuty service health issues',
      eventPattern: {
        source: ['aws.guardduty'],
        detailType: ['GuardDuty Service Health'],
        detail: {
          status: ['UNHEALTHY', 'ERROR'],
        },
      } as EventPattern,
    });

    // Add SNS topic as target for health rule
    guardDutyHealthRule.addTarget(new SnsTopic(this.snsTopic));
  }
}
