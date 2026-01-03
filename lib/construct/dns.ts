import {
  aws_certificatemanager as acm,
  aws_route53 as route53,
  aws_route53_targets as targets,
} from "aws-cdk-lib";
import { ILoadBalancerV2 } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { IDistribution } from "aws-cdk-lib/aws-cloudfront";
import { Construct } from "constructs";

export interface DnsProps {
  domainName: string;
}

export class Dns extends Construct {
  public readonly hostedZone: route53.IHostedZone;
  public readonly albCertificate: acm.Certificate;

  constructor(scope: Construct, id: string, props: DnsProps) {
    super(scope, id);

    // Route53ホストゾーンを取得
    this.hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: props.domainName,
    });

    // ACM証明書を作成（Route53で自動検証）
    this.albCertificate = new acm.Certificate(this, "AlbCertificate", {
      domainName: props.domainName,
      subjectAlternativeNames: [`api.${props.domainName}`],
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
    });
  }

  // Route53レコードを作成するメソッド
  public createDnsRecords(
    cloudFrontDistribution: IDistribution,
    alb: ILoadBalancerV2,
    domainName: string
  ) {
    // CloudFrontのAレコード
    new route53.ARecord(this, "CloudFrontARecord", {
      zone: this.hostedZone,
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(cloudFrontDistribution)
      ),
    });

    // ALBのAレコード（api サブドメイン用）
    new route53.ARecord(this, "AlbARecord", {
      zone: this.hostedZone,
      recordName: `api.${domainName}`,
      target: route53.RecordTarget.fromAlias(
        new targets.LoadBalancerTarget(alb)
      ),
    });
  }
}
