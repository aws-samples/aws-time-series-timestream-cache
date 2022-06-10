import { SQSHandler } from "aws-lambda";
import AWS = require("aws-sdk");
interface DynamoItem {
  identifier: string;
  time: number;
  value: string;
  metadata: string;
  document: string;
  expiry: number;
}

/**
 * Past records go into timestream here, it cannot natively store future dates so we need to use both.
 */
export const uploadPastRecordsIntoTimestream = async (pastRecords: AWS.TimestreamWrite.Record[]) => {
  const https = require("https");
  const agent = new https.Agent({
    maxSockets: 5000,
  });

  const writeClient = new AWS.TimestreamWrite({
    maxRetries: 10,
    httpOptions: {
      timeout: 20000,
      agent: agent,
    },
  });

  console.log(`Putting ${pastRecords.length} records into timestream.`);

  while (pastRecords.length) {
    const request: any = writeClient.writeRecords({
      DatabaseName: process.env.TS_DB_NAME!,
      TableName: process.env.TS_TABLE_NAME!,
      Records: pastRecords.splice(0, 100), // 100 at a time. Timestream limitations
    });

    await request.promise().then(
      () => {
        console.log("Write records successful");
      },
      (err: any) => {
        console.log("Error writing records:", err);
        if (err.code === "RejectedRecordsException") {
          const responsePayload = JSON.parse(request.response.httpResponse.body.toString());
          console.log("RejectedRecords: ", responsePayload.RejectedRecords);
          console.log("Other records were written successfully. ");
        }
      }
    );
  }
};

/**
 * Future records go into DynamoDB here.
 */
const uploadFutureRecordsIntoDynamo = async (futureRecords: DynamoItem[]) => {
  console.log(`Inserting ${futureRecords.length} items into DynamoDB`);
  const docClient = new AWS.DynamoDB.DocumentClient();
  while (futureRecords.length) {
    const futureTableParams: AWS.DynamoDB.DocumentClient.BatchWriteItemInput = {
      RequestItems: {
        [process.env.FUTURE_TABLE!]: futureRecords.splice(0, 25).map((fc) => ({
          // 25 at a time
          PutRequest: {
            Item: fc,
          },
        })),
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
  }
};

/**
 * The source of your time-series data might require credentials. This is an example of how and where to store them
 */
const getAPIKey = async () => {
  const ssm = new AWS.SSM();

  if (!process.env.API_KEY && process.env.API_KEY_SSM_ID) {
    const ssmParams = {
      Name: process.env.API_KEY_SSM_ID,
    };
    const key = await ssm.getParameter(ssmParams).promise();
    return key.Parameter?.Value;
  }

  return process.env.API_KEY;
};

/**
 * Small mapping function to get the data into the correct format for Timestream
 * Extra data will go into 'Dimensions'
 */
const mapRecordToTimestream = (record: APIResponseRecord): AWS.TimestreamWrite.Record => {
  return {
    // extra values you can filter and query on
    Dimensions: [
      {
        Name: "identifier",
        Value: record.identifier,
      },
    ],
    MeasureName: "cpu usage",
    MeasureValue: record.value, // The main value for the Timestream record
    MeasureValueType: "VARCHAR",
    Time: record.time.toString(), // Get from record
    TimeUnit: "SECONDS",
  };
};

interface APIResponseRecord {
  identifier: string;
  value: string;
  time: number;
  metadata: string;
}

// TODO: replace this with an api call instead. This just generates dummy data.
export const spoofRecords = (identifier: string): APIResponseRecord[] => {
  const records: APIResponseRecord[] = [];
  const now = Math.round(Date.now() / 1000);
  const startTime = now - 60 * 60 * 24;
  const endTime = now + 60 * 60 * 24;
  let currentTime = startTime;

  while (currentTime < endTime) {
    const record = {
      identifier,
      value: Math.round(Math.random() * 100).toString(),
      time: currentTime,
      metadata: currentTime < now ? "Past" : "Future",
    };
    records.push(record);
    currentTime += 60 * 5; // 5 minute increments
  }
  return records;
};

const getRecordsFromAPI = async (identifier: string, apiKey: string): Promise<APIResponseRecord[]> => {
  console.log("API key being provided but not used");
  return spoofRecords(identifier);
};

const categoriseResults = (apiResults: APIResponseRecord[]) => {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 7); // 7 day expiry on dynamo records so they clean themselves up
  const expiryTime = expiryDate.getTime() / 1000;

  const pastRecords: AWS.TimestreamWrite.Record[] = [];
  const futureRecords: DynamoItem[] = [];
  const now = Math.round(Date.now() / 1000);

  apiResults.forEach((identifierRecord) => {
    if (identifierRecord.time < now) {
      const record: AWS.TimestreamWrite.Record = mapRecordToTimestream(identifierRecord);
      pastRecords.push(record);
    } else {
      futureRecords.push({
        identifier: identifierRecord.identifier,
        time: identifierRecord.time,
        value: identifierRecord.value,
        metadata: identifierRecord.metadata,
        document: JSON.stringify(identifierRecord),
        expiry: Math.round(expiryTime),
      });
    }
  });

  return { pastRecords, futureRecords };
};

const checkEnvironmentVariables = () => {
  if (!process.env.TS_DB_NAME) {
    throw new Error("Past Timestream DB name missing");
  }
  if (!process.env.TS_TABLE_NAME) {
    throw new Error("Past Timestream table name missing");
  }

  if (!process.env.FUTURE_TABLE) {
    throw new Error("Future DynamoDB table name is missing.");
  }
};

export const handler: SQSHandler = async (event) => {
  checkEnvironmentVariables();

  const APIKey = await getAPIKey();

  if (!APIKey) {
    throw new Error("API key key not provided in any way");
  }

  const messageRecords: { identifiers: string[] }[] = event.Records.map((record) => JSON.parse(record.body));

  for (const mr of messageRecords) {
    const { identifiers } = mr;

    let apiResults: APIResponseRecord[] = [];

    for (const identifier of identifiers) {
      const records = await getRecordsFromAPI(identifier, APIKey);
      apiResults = apiResults.concat(records);
    }

    const { pastRecords, futureRecords } = categoriseResults(apiResults);

    if (pastRecords.length) {
      await uploadPastRecordsIntoTimestream(pastRecords);
    }

    if (futureRecords.length) {
      await uploadFutureRecordsIntoDynamo(futureRecords);
    }

    console.log(`Done!`);
  }
};
