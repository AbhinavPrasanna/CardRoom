import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

export interface GameWsStackProps extends cdk.StackProps {
  /** Issued for the hostname you will use in the browser (e.g. game.example.com). Same region as stack. */
  certificateArn: string;
}

export class GameWsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GameWsStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "GameWsVpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: "Public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "Private", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

    const cluster = new ecs.Cluster(this, "GameWsCluster", {
      vpc,
      clusterName: "game-ws-cluster",
      containerInsights: true,
    });

    const logGroup = new logs.LogGroup(this, "GameWsLogGroup", {
      logGroupName: "/ecs/game-ws",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, "GameWsTaskDef", {
      memoryLimitMiB: 1024,
      cpu: 512,
      family: "game-ws-task",
    });

    const image = ecs.ContainerImage.fromAsset(path.join(__dirname, "..", "..", "services", "game-ws"));

    const container = taskDefinition.addContainer("GameWsContainer", {
      image,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "game-ws",
        logGroup,
      }),
      environment: {
        NODE_ENV: "production",
        PORT: "8080",
      },
    });

    container.addPortMappings({
      containerPort: 8080,
      protocol: ecs.Protocol.TCP,
    });

    const albSg = new ec2.SecurityGroup(this, "AlbSg", {
      vpc,
      description: "ALB",
      allowAllOutbound: true,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS");

    const svcSg = new ec2.SecurityGroup(this, "ServiceSg", {
      vpc,
      description: "Fargate tasks",
      allowAllOutbound: true,
    });
    svcSg.addIngressRule(albSg, ec2.Port.tcp(8080), "ALB to app");

    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
    });

    const certificate = acm.Certificate.fromCertificateArn(this, "TlsCert", props.certificateArn);

    const targetGroup = new elbv2.ApplicationTargetGroup(this, "GameTg", {
      vpc,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: "/health",
        healthyHttpCodes: "200",
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      stickinessCookieDuration: cdk.Duration.hours(24),
    });

    alb.addListener("Https", {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [certificate],
      defaultTargetGroups: [targetGroup],
    });

    const service = new ecs.FargateService(this, "GameSvc", {
      cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [svcSg],
      circuitBreaker: { rollback: true },
    });

    service.attachToApplicationTargetGroup(targetGroup);

    new cdk.CfnOutput(this, "AlbDnsName", {
      value: alb.loadBalancerDnsName,
      description: "Create a DNS alias (e.g. game.example.com) to this name; use that host for wss://",
    });

    new cdk.CfnOutput(this, "WebSocketUrlHint", {
      value: `wss://YOUR-DOMAIN/ws  (cert must match YOUR-DOMAIN; raw ALB DNS will TLS-fail)`,
      description: "WebSocket path is /ws",
    });

    new cdk.CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    new cdk.CfnOutput(this, "ServiceName", { value: service.serviceName });
    new cdk.CfnOutput(this, "LogGroup", { value: logGroup.logGroupName });
  }
}
