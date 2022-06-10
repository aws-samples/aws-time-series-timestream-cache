// This is a file to hydrate the sample solution with some dummy data
import { Lambda, config } from "aws-sdk";
import axios from "axios";
config.region = "us-west-2";
var lambda = new Lambda();

import { DynamoDB } from "aws-sdk";

const uploadHydrateRecordIntoDynamo = async (tableName: string) => {
  const docClient = new DynamoDB.DocumentClient();

  console.log("Hydrating DynamoDB");

  const futureTableParams: DynamoDB.DocumentClient.BatchWriteItemInput = {
    RequestItems: {
      [tableName]: [
        {
          PutRequest: {
            Item: { identifier: "test-run" },
          },
        },
      ],
    },
  };

  await docClient
    .batchWrite(futureTableParams, (err) => {
      if (err) {
        console.error("Error writing to dynamo. Error:", JSON.stringify(err, null, 2));
      } else {
        console.log("Write succeeded.");
      }
    })
    .promise();
};

const triggerQueueLambda = async (queueLambdaName: string) => {
  var params: Lambda.InvocationRequest = {
    FunctionName: queueLambdaName, // the lambda function we are going to invoke
    InvocationType: "Event",
    LogType: "Tail",
    Payload: "",
  };

  console.log("Invoking Queue Lambda");
  await new Promise((res) => {
    lambda.invoke(params, function (err, data) {
      if (err) {
        throw new Error(err.message);
      } else {
        res(data);
        console.log("Queue Lambda invoked");
      }
    });
  });
};

const pollAPI = async (apiEndpoint: string, apiKey: string) => {
  let done = false;
  let counter = 1;
  const errors = [];

  while (!done && counter < 300) {
    try {
      const { data } = await axios.get(apiEndpoint, {
        headers: { "x-security-token": apiKey },
        params: {
          startDate: Date.now() - 1000 * 60 * 60 * 24 * 4,
          endDate: Date.now() + 1000 * 60 * 60 * 24 * 4,
          identifier: "test-run",
        },
      });
      if (data.historicalRows.length) {
        done = true;
        console.log("Rows found in API: ", data.historicalRows.length);
        console.log("Everything is hooked up!");
      } else {
        console.log("No rows found yet Tries: ", counter++);
      }
    } catch (e) {
      errors.push(e);
      console.log(
        "Error from API call. This is usually due to timestream not having the expected columns yet. It should populate soon. Error count: ",
        errors.length
      );
      if (errors.length > 20) {
        console.log(e);
        throw new Error("There are a bunch of errors which isn't expected. Here's the first one above");
      }
    }
  }
};

const hydrate = async () => {
  console.log("API_ENDPOINT=", process.env.API_ENDPOINT);
  console.log("API_KEY=", process.env.API_KEY);
  console.log("ID_TABLE=", process.env.ID_TABLE);
  console.log("QUEUE_LAMBDA_NAME=", process.env.QUEUE_LAMBDA_NAME);

  await uploadHydrateRecordIntoDynamo(process.env.ID_TABLE!);
  await triggerQueueLambda(process.env.QUEUE_LAMBDA_NAME!);
  await pollAPI(`${process.env.API_ENDPOINT}timeSeries-data`, process.env.API_KEY!);
};

hydrate();
