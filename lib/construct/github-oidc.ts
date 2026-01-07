import {
  aws_iam as iam,
  aws_s3 as s3,
  aws_cloudfront as cloudfront,
} from "aws-cdk-lib";
import { Construct } from "constructs";

export interface GitHubOidcProps {
  githubOrganization: string;
  githubRepositories: string[];
  staticSiteBucket: s3.IBucket;
  deployBucket: s3.IBucket;
  cloudfrontDistribution: cloudfront.IDistribution;
  env: {
    account: string;
    region: string;
  };
}

export class GitHubOidc extends Construct {
  public readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: GitHubOidcProps) {
    super(scope, id);

    // GitHub OIDC Identity Provider
    const githubOidcProvider = new iam.OpenIdConnectProvider(
      this,
      "GitHubOidcProvider",
      {
        url: "https://token.actions.githubusercontent.com",
        clientIds: ["sts.amazonaws.com"],
      }
    );

    // GitHub Actions用のIAM Role
    this.deployRole = new iam.Role(this, "GitHubActionsDeployRole", {
      roleName: `${props.env.account}-github-actions-deploy-role`,
      description:
        "IAM Role for GitHub Actions to deploy application services (S3/CloudFront)",
      assumedBy: new iam.WebIdentityPrincipal(
        githubOidcProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          },
          StringLike: {
            "token.actions.githubusercontent.com:sub":
              props.githubRepositories.flatMap((repo) => [
                `repo:${props.githubOrganization}/${repo}:ref:refs/heads/*`,
              ]),
          },
        }
      ),
    });

    this.addBasicAwsPolicies(props);
  }

  private addBasicAwsPolicies(props: GitHubOidcProps) {
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "S3FrontendDeployPermissions",
        actions: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
          "s3:GetBucketLocation",
          "s3:PutObjectAcl",
        ],
        resources: [props.staticSiteBucket.bucketArn, `${props.staticSiteBucket.bucketArn}/*`],
      })
    );

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "CloudFrontInvalidationPermissions",
        actions: [
          "cloudfront:CreateInvalidation",
          "cloudfront:GetInvalidation",
          "cloudfront:ListInvalidations",
        ],
        resources: [props.cloudfrontDistribution.distributionArn],
      })
    );

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "S3CodeDeployUploadPermissions",
        actions: ["s3:PutObject", "s3:GetBucketLocation"],
        resources: [`${props.deployBucket.bucketArn}/*`],
      })
    );

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "CodeDeployActionPermissions",
        actions: [
          "codedeploy:CreateDeployment",
          "codedeploy:GetDeployment",
          "codedeploy:GetDeploymentConfig",
          "codedeploy:RegisterApplicationRevision",
          "codedeploy:GetApplication",
        ],
        resources: [
          `arn:aws:codedeploy:${props.env.region}:${props.env.account}:application:CloudDriverEc2ArchitectureTestApp`,
          `arn:aws:codedeploy:${props.env.region}:${props.env.account}:deploymentgroup:CloudDriverEc2ArchitectureTestApp/CloudDriverEc2ArchitectureTestDeploymentGroup`,
          `arn:aws:codedeploy:${props.env.region}:${props.env.account}:deploymentconfig:*`,
        ],
      })
    );
  }
}
