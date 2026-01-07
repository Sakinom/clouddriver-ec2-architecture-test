// 環境ごとのパラメータ定義
export interface EnvironmentParameter {
  env: {
    account: string;
    region: string;
  };
  description: string;
  vpcCidr: string;
  maxAzs: number;
  natGateways: number;
  domainName: string;
  cloudfrontCertificate: string;
  cloudWatchLogsRetention: number;
  bucketLogRetention: number;
  notificationRecipientEmail: string;
  canaryUrl: string;
  cloudTrailLogRetention: number;
  datastore: {
    backupRetentionDays: number;
    monthlyBackupRetentionDays: number;
  };
  appService: {
    cpu: number;
    memory: number;
  };
  webAclArn?: string;
  github: {
    organization: string;
    repositories: string[];
  };
}

export const parameter: EnvironmentParameter = {
  env: {
    account: "577018705349",
    region: "ap-northeast-1",
  },
  description: "CloudDriver EC2 Infrastructure Test Stack",
  vpcCidr: "10.0.0.0/16",
  maxAzs: 2,
  natGateways: 2,
  domainName: "00770.clouddriver-exam.net",
  cloudfrontCertificate:
    "arn:aws:acm:us-east-1:577018705349:certificate/9e6db63f-1c21-4b71-add5-08215626d566",
  cloudWatchLogsRetention: 3,
  bucketLogRetention: 30,
  cloudTrailLogRetention: 90, // ステージング環境は90日保持
  notificationRecipientEmail: "sakinom328@gmail.com",
  canaryUrl: "https://00770.clouddriver-exam.net/",
  datastore: {
    backupRetentionDays: 1,
    monthlyBackupRetentionDays: 30, // 1ヶ月
  },
  appService: {
    cpu: 2048, // 2 vCPU
    memory: 4096, // 4 GB
  },
  github: {
    organization: "clouddriver-exam", // TODO: 実際のGitHub組織名に変更する必要がある
    repositories: ["clouddriver-ec2-architecture-test-app"], // TODO: 実際のリポジトリ名に変更する必要がある
  },
};
