import { Construct } from 'constructs';
import { CfnConfigurationRecorder, CfnDeliveryChannel } from 'aws-cdk-lib/aws-config';
import { Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { RemovalPolicy, Duration } from 'aws-cdk-lib';

export interface AwsConfigProps {
  bucketLogRetention: number;
}

export class AwsConfig extends Construct {
  public readonly configurationRecorder: CfnConfigurationRecorder;
  public readonly deliveryChannel: CfnDeliveryChannel;
  public readonly configBucket: Bucket;

  constructor(scope: Construct, id: string, props: AwsConfigProps) {
    super(scope, id);

    // S3 Bucket for AWS Config
    this.configBucket = new Bucket(this, 'ConfigBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      versioned: true,
      lifecycleRules: [
        {
          id: 'DeleteOldVersions',
          enabled: true,
          noncurrentVersionExpiration: Duration.days(props.bucketLogRetention),
        },
        {
          id: 'DeleteIncompleteMultipartUploads',
          enabled: true,
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // IAM Role for AWS Config
    const configRole = new Role(this, 'ConfigRole', {
      roleName: `aws-config-role`,
      assumedBy: new ServicePrincipal('config.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWS_ConfigRole'),
      ],
    });

    // Grant Config service permissions to write to S3 bucket
    this.configBucket.grantWrite(configRole);

    // Configuration Recorder
    this.configurationRecorder = new CfnConfigurationRecorder(this, 'ConfigurationRecorder', {
      name: `config-recorder`,
      roleArn: configRole.roleArn,
      recordingGroup: {
        allSupported: true,
        includeGlobalResourceTypes: true,
        resourceTypes: [],
      },
    });

    // Delivery Channel
    this.deliveryChannel = new CfnDeliveryChannel(this, 'DeliveryChannel', {
      name: `config-delivery-channel`,
      s3BucketName: this.configBucket.bucketName,
      configSnapshotDeliveryProperties: {
        deliveryFrequency: 'TwentyFour_Hours',
      },
    });
  }
}
