#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { GameWsStack } from "../lib/game-ws-stack";

const app = new cdk.App();

const certArn = app.node.tryGetContext("certArn") as string | undefined;
if (!certArn?.trim()) {
  throw new Error(
    'Missing ACM certificate ARN. Deploy with: npx cdk deploy -c certArn="arn:aws:acm:REGION:ACCOUNT:certificate/UUID"',
  );
}

new GameWsStack(app, "GameWsStack", {
  certificateArn: certArn.trim(),
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-west-1",
  },
});
