import { Duration } from "aws-cdk-lib";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime, ILayerVersion, FileSystem } from "aws-cdk-lib/aws-lambda";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { ISecurityGroup, IVpc } from "aws-cdk-lib/aws-ec2";

import * as path from "path";
import { Construct } from "constructs";

export interface LambdaConfig {
  construct: Construct;
  durationSeconds: number;
  memorySizeMb: number;
  environment?: {};
  bundling?: string[];
  description?: string;
  externalModules?: string[];
  directory: string;
  handlerFile: string;
  policyActions?: string[];
  policyResources?: string[];
  layers?: ILayerVersion[];
  reservedConcurrency?: number;
  vpc?: IVpc;
  filesystem?: FileSystem;
  securityGroups?: ISecurityGroup[];
}

export const createTSLambda = (configs: LambdaConfig) => {
  const nodeFn = new NodejsFunction(configs.construct, `Lambda${configs.handlerFile}`, {
    functionName: `Lambda-${configs.handlerFile}`,
    runtime: Runtime.NODEJS_14_X,
    handler: "handler",
    entry: path.join(__dirname, `../../lambdas/${configs.directory}/${configs.handlerFile}.ts`),
    description: configs.description || "",
    timeout: Duration.seconds(configs.durationSeconds),
    memorySize: configs.memorySizeMb,
    logRetention: RetentionDays.TWO_WEEKS,
    bundling: {
      externalModules: ["aws-sdk", ...(configs.externalModules || [])],
      nodeModules: configs.bundling || [],
    },
    environment: configs.environment || {},
  });

  if (configs.policyActions && configs.policyActions.length > 0) {
    nodeFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: configs.policyActions,
        resources: configs.policyResources,
      })
    );
  }

  return nodeFn;
};
