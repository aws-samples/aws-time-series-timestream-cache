import { CfnOutput, Duration, Stack } from "aws-cdk-lib";
import { Table, BillingMode, AttributeType } from "aws-cdk-lib/aws-dynamodb";
import { RestApi, LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { CfnDatabase, CfnTable } from "aws-cdk-lib/aws-timestream";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { createTSLambda } from "../utils/lambda";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export class TimeSeriesStack extends Stack {
  constructor(construct: Construct, id: string) {
    super(construct, id);

    // unique identifiers to cache.
    const identifierTable = new Table(this, "IdentifierTable", {
      partitionKey: { name: "identifier", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
    });

    const timeSeriesTable = new Table(this, "TimeSeriesTable", {
      sortKey: { name: "time", type: AttributeType.NUMBER },
      partitionKey: { name: "identifier", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiry",
    });

    const identifierDLQ = new Queue(this, "IdentifierDLQ", {
      retentionPeriod: Duration.days(14),
      visibilityTimeout: Duration.seconds(120),
      encryption: QueueEncryption.KMS_MANAGED,
    });

    const identifierQueue = new Queue(this, "IdentifierQueue", {
      visibilityTimeout: Duration.seconds(120),
      retentionPeriod: Duration.days(2),
      encryption: QueueEncryption.KMS_MANAGED,
      deadLetterQueue: {
        maxReceiveCount: 2,
        queue: identifierDLQ,
      },
    }); // defaults for now

    const IdentifierQueueLambda = createTSLambda({
      construct: this,
      durationSeconds: 60,
      memorySizeMb: 128,
      description: "TimeSeries queuing lambda",
      directory: "queue",
      handlerFile: "queue-index",
      environment: {
        IDENTIFIER_TABLE: identifierTable.tableName,
        IDENTIFIER_QUEUE: identifierQueue.queueUrl,
      },
    });

    const lambdaTimeSeriesCronTrigger = new Rule(this, "IdentifierQueueLambdaCronRule", {
      schedule: Schedule.expression("cron(0 1 * * ? *)"), // 1am UTC every day adjust to be as frequent as you need
    });

    identifierTable.grantReadData(IdentifierQueueLambda);
    lambdaTimeSeriesCronTrigger.addTarget(new targets.LambdaFunction(IdentifierQueueLambda));
    identifierQueue.grantSendMessages(IdentifierQueueLambda);

    const tsDB = new CfnDatabase(this, `TimeSeriesStackTimestreamDB`, {
      databaseName: "TimeSeriesDB",
    });

    const tsTable = new CfnTable(this, `TimeSeriesTimestreamTable`, {
      databaseName: "TimeSeriesDB",
      tableName: "identifierTimeSeriesHistory",
      retentionProperties: {
        memoryStoreRetentionPeriodInHours: 24 * 30, // One month for newer data
        magneticStoreRetentionPeriodInDays: 365 * 2, // 2 years for older data
      },
      magneticStoreWriteProperties: {
        EnableMagneticStoreWrites: true, // so you can write old (2 months +) data if you need to
      },
    });

    tsTable.addDependsOn(tsDB);

    // TODO: CDK has a limitation where you cannot create encrypted SSM keys.
    // It's highly recommended that you create the key manually in console and reference it here instead.
    const cacheApiSSMKey = new ssm.StringParameter(this, "APICacheSSMKey", {
      allowedPattern: ".*",
      description: "Key to the API you are caching",
      parameterName: "CachedAPIKey",
      stringValue: "No-Key-Provided",
    });

    const timeSeriesLambda = createTSLambda({
      construct: this,
      durationSeconds: 60,
      memorySizeMb: 512,
      description: "TimeSeries retrieval lambda",
      directory: "timeSeries",
      handlerFile: "timeSeries-index",
      bundling: ["typescript", "ts-node"],
      environment: {
        TS_DB_NAME: tsDB.databaseName,
        TS_TABLE_NAME: tsTable.tableName,
        FUTURE_TABLE: timeSeriesTable.tableName,
        API_KEY_SSM_ID: cacheApiSSMKey.parameterName,
      },
      policyActions: [
        "timestream:WriteRecords",
        "timestream:Select",
        "timestream:CancelQuery",
        "timestream:ListTables",
      ],
      policyResources: [tsTable.attrArn, tsDB.attrArn],
    });

    cacheApiSSMKey.grantRead(timeSeriesLambda);

    timeSeriesTable.grantWriteData(timeSeriesLambda);

    const identifierSQSEventSource = new SqsEventSource(identifierQueue);

    timeSeriesLambda.addEventSource(identifierSQSEventSource);

    const lambdaTimestreamPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["timestream:DescribeEndpoints", "timestream:ListDatabases"],
      resources: ["*"], // Required by Timestream to be *
    });

    timeSeriesLambda.addToRolePolicy(lambdaTimestreamPolicy);

    // TODO: CDK has a limitation where you cannot create encrypted SSM keys.
    // If using this method of auth for API Gateway
    // It's highly recommended that you create the key manually in console and reference it here instead.
    const apiGWSSMKey = new ssm.StringParameter(this, "APIAccessSSMKey", {
      allowedPattern: ".*",
      description: "Key to the timeSeries API calls",
      parameterName: "ExposedAPIKey",
      stringValue: "No-Key-Provided",
    });

    const apiLambda = createTSLambda({
      construct: this,
      durationSeconds: 60,
      memorySizeMb: 256,
      description: "TimeSeries API Lambda",
      directory: "api",
      handlerFile: "api-index",
      bundling: ["typescript", "ts-node"],
      environment: {
        TS_DB_NAME: tsDB.databaseName,
        TS_TABLE_NAME: tsTable.tableName,
        FUTURE_TABLE: timeSeriesTable.tableName,
        API_SSM_ID: apiGWSSMKey.parameterName,
      },
      policyActions: [
        "timestream:WriteRecords",
        "timestream:Select",
        "timestream:CancelQuery",
        "timestream:ListTables",
      ],
      policyResources: [tsTable.attrArn, tsDB.attrArn],
    });

    apiGWSSMKey.grantRead(apiLambda);
    apiLambda.addToRolePolicy(lambdaTimestreamPolicy);

    const api = new RestApi(this, "TimeSeries-API", {
      restApiName: "TimeSeries Service",
      description: "This service serves timeSeries data given a start and end date.",
    });

    api.root.addProxy({
      defaultIntegration: new LambdaIntegration(apiLambda),

      // "false" will require explicitly adding methods on the `proxy` resource
      anyMethod: true, // TODO restrict to GET
    });

    timeSeriesTable.grantReadData(apiLambda);

    new CfnOutput(this, "APIUrl", {
      value: api.url,
    });

    new CfnOutput(this, "IDTableName", {
      value: identifierTable.tableName,
    });

    new CfnOutput(this, "QueueingLambdaName", {
      value: IdentifierQueueLambda.functionName,
    });
  }
}
