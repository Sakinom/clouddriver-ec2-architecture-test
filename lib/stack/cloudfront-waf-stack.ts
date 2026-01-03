import { Stack, StackProps, aws_s3 as s3 } from "aws-cdk-lib";
import { Construct } from "constructs";
import { CloudFrontWaf } from "../construct/cloudfront-waf";

export interface CloudFrontWafStackProps extends StackProps {
  description: string;
}

export class CloudFrontWafStack extends Stack {
  constructor(scope: Construct, id: string, props: CloudFrontWafStackProps) {
    super(scope, id, props);

    const cloudFrontWaf = new CloudFrontWaf(this, "CloudFrontWaf");
  }
}
