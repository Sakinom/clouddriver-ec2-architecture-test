import { aws_s3 as s3, aws_codedeploy as codedeploy, aws_autoscaling as autoscaling, aws_iam as iam } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";

export interface CodeDeployProps {
  description: string;
  asg: autoscaling.AutoScalingGroup;
}

export class CodeDeploy extends Construct {
  public readonly deployBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: CodeDeployProps) {
    super(scope, id);

    const deployBucket = new s3.Bucket(this, "DeployBucket", {
      bucketName: `deploy-artifacts-${cdk.Aws.ACCOUNT_ID}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });
    this.deployBucket = deployBucket;

    const application = new codedeploy.ServerApplication(this, 'CodeDeployApplication', {
      applicationName: 'CloudDriverEc2ArchitectureTestApp',
    });

    const deploymentGroup = new codedeploy.ServerDeploymentGroup(this, 'CodeDeployDeploymentGroup', {
      application: application,
      deploymentGroupName: 'CloudDriverEc2ArchitectureTestDeploymentGroup',
      autoScalingGroups: [props.asg],
      deploymentConfig: codedeploy.ServerDeploymentConfig.ALL_AT_ONCE,
      // cdkがEC2のブルー/グリーンデプロイメントに対応していないため、コンソールにてAutoScalingGroupsとLoadBalancerの設定を追加済み
    });

    deploymentGroup.role?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSCodeDeployRole')
    );

    deploymentGroup.role?.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: [
        "iam:PassRole",
        "ec2:CreateTags",
        "ec2:RunInstances",
        "autoscaling:Describe*",
        "autoscaling:CreateAutoScalingGroup",
        "autoscaling:UpdateAutoScalingGroup",
        "autoscaling:DeleteAutoScalingGroup",
        "autoscaling:PutLifecycleHook",
        "autoscaling:DeleteLifecycleHook",
        "autoscaling:CompleteLifecycleAction",
        "autoscaling:PutScalingPolicy",
        "autoscaling:DeleteScalingPolicy"
      ],
      resources: ["*"],
    }));
  }
}
