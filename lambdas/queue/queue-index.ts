import * as AWS from "aws-sdk";

export const handler = async () => {
  const uid = Date.now();

  if (!process.env.IDENTIFIER_TABLE) {
    throw new Error("IDENTIFIER_TABLE is undefined.");
  }

  if (!process.env.IDENTIFIER_QUEUE) {
    throw new Error("IDENTIFIER_QUEUE is undefined.");
  }

  const identifiers = new Set<number>();

  const docClient = new AWS.DynamoDB.DocumentClient();

  const dynamoParams = {
    TableName: process.env.IDENTIFIER_TABLE ?? "",
  };

  await docClient
    .scan(dynamoParams, (err, data) => {
      if (err) {
        console.error("Unable to scan. Error:", JSON.stringify(err, null, 2));
      } else {
        console.log("Scan succeeded.");
        console.log("Data items found", data);
        data.Items?.forEach((item) => {
          identifiers.add(item.identifier);
        });
      }
    })
    .promise();

  const entries: AWS.SQS.SendMessageBatchRequestEntryList = [];

  let currentIdentifiers: number[] = [];
  let message = 0;

  console.log("Creating SQS events for identifiers");

  identifiers.forEach((identifier) => {
    currentIdentifiers.push(identifier);
    if (currentIdentifiers.length === 2) {
      // After gauging how many codes make sense to run in a lambda
      // Depending on your API it might be more or less
      entries.push({
        Id: `${message++}-${uid}`,
        MessageBody: JSON.stringify({ identifiers: currentIdentifiers }),
      });
      currentIdentifiers = [];
    }
  });

  if (currentIdentifiers.length) {
    entries.push({
      Id: `${message++}-${uid}`,
      MessageBody: JSON.stringify({ identifiers: currentIdentifiers }),
    });
  }

  console.log("Example first event: ", entries[0]);

  const sqsParams = {
    Entries: entries,
    QueueUrl: process.env.IDENTIFIER_QUEUE,
  };

  console.log(`creating ${entries.length} messages in sqs`);

  const sqs = new AWS.SQS();
  const response = await sqs.sendMessageBatch(sqsParams).promise();

  console.log(response);
};
