#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { GameWsStack } from "../lib/game-ws-stack";

const app = new cdk.App();

/** Set via CLI (-c certArn=...) or env so PowerShell sessions do not lose context between commands. */
const certArn = (
  (app.node.tryGetContext("certArn") as string | undefined) ||
  process.env.CDK_CERT_ARN ||
  process.env.GAME_WS_CERT_ARN ||
  ""
).trim();

if (!certArn) {
  throw new Error(
    [
      "Missing ACM certificate ARN for the HTTPS listener.",
      "",
      "Option A — pass context (any shell):",
      '  npx cdk deploy -c certArn="arn:aws:acm:REGION:ACCOUNT:certificate/UUID"',
      "",
      "Option B — PowerShell env (same window for the whole deploy):",
      '  $env:CDK_CERT_ARN="arn:aws:acm:us-west-1:YOUR_ACCOUNT:certificate/YOUR_UUID"',
      "  npx cdk deploy",
      "",
      "List certs in us-west-1: aws acm list-certificates --region us-west-1",
    ].join("\n"),
  );
}

new GameWsStack(app, "GameWsStack", {
  certificateArn: certArn,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-west-1",
  },
});
