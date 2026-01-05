import { Construct } from "constructs";
import { CfnReplicationGroup, CfnSubnetGroup } from 'aws-cdk-lib/aws-elasticache';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ssm from 'aws-cdk-lib/aws-ssm';

interface ElastiCacheProps {
  vpc: ec2.IVpc;
  appSg: ec2.ISecurityGroup;
}

export class ElastiCache extends Construct {
  public readonly redisEndpointParameter: ssm.IStringParameter;

  constructor(scope: Construct, id: string, props: ElastiCacheProps) {
    super(scope, id);

    const subnetGroup = new CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Redis',
      subnetIds: props.vpc.privateSubnets.map(s => s.subnetId),
    });

    const elasticacheSg = new ec2.SecurityGroup(this, "ElastiCacheSecurityGroup", {
      vpc: props.vpc,
      allowAllOutbound: true,
      description: "ElastiCache Security Group",
      securityGroupName: "ElastiCacheSecurityGroup"
    });
    elasticacheSg.addIngressRule(props.appSg, ec2.Port.tcp(6379), "Allow Redis access from EC2");

    const redis = new CfnReplicationGroup(this, "ReplicationGroup", {
      replicationGroupDescription: "Elastic Cache Replication Group",
      numCacheClusters: 2,
      automaticFailoverEnabled: false,
      engine: 'redis',
      cacheNodeType: 'cache.t4g.micro',
      cacheSubnetGroupName: subnetGroup.ref,
      securityGroupIds:[elasticacheSg.securityGroupId],
    });
    redis.addDependency(subnetGroup);

    const redisEndpointParameter = new ssm.StringParameter(this, 'RedisEndpointParam', {
      parameterName: '/app/redis/endpoint',
      stringValue: redis.attrPrimaryEndPointAddress,
    });
    this.redisEndpointParameter = redisEndpointParameter;
  }
}
