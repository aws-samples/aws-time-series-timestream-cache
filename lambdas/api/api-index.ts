import AWS = require("aws-sdk");

import { APIGatewayProxyHandler } from "aws-lambda";

interface ReturnRow {
  identifier?: string;
  cpu?: string;
  time?: number;
}

const getDateRange = (date: string) => {
  const dateObj = new Date(parseInt(date));
  const dateNow = new Date();
  if (dateObj.getTime() < dateNow.getTime()) {
    const hoursBack = Math.round((dateNow.getTime() - dateObj.getTime()) / (1000 * 60 * 60));
    return `ago(${hoursBack}h)`;
  } else {
    return "now()";
  }
};

const getAPIKey = async () => {
  const ssm = new AWS.SSM();

  if (!process.env.API_KEY && process.env.API_SSM_ID) {
    const ssmParams = {
      Name: process.env.API_SSM_ID ?? "",
    };
    const key = await ssm.getParameter(ssmParams).promise();
    return key.Parameter?.Value;
  }

  return process.env.API_KEY;
};

let apiKey: string;

export const handler: APIGatewayProxyHandler = async (event) => {
  console.log("API GW handler timeSeries service");
  if (!apiKey) {
    apiKey = (await getAPIKey()) ?? "";
    if (apiKey === "") {
      throw new Error("API key has not been set up in SMM");
    }
  }

  try {
    // As this is a demo api this is not the ideal level of security
    // Normally you would have the security layer at the API Gateway level. This is for the sake of simplicity.
    if (event.headers["x-security-token"] !== apiKey) {
      throw new Error("x-security-token not present or incorrect");
    }
    if (!process.env.TS_DB_NAME) {
      throw new Error("Timestream DB name missing");
    }
    if (!process.env.TS_TABLE_NAME) {
      throw new Error("Timestream table name missing");
    }

    if (!process.env.FUTURE_TABLE) {
      throw new Error("FUTURE_TABLE is undefined.");
    }

    const https = require("https");
    const agent = new https.Agent({
      maxSockets: 5000,
    });

    const queryClient = new AWS.TimestreamQuery({
      maxRetries: 10,
      httpOptions: {
        timeout: 20000,
        agent: agent,
      },
    });

    const method = event.httpMethod;

    if (method === "GET") {
      console.log(event.path);
      if (event.path === "/timeSeries-data") {
        if (!event.queryStringParameters) {
          throw new Error("No querystring params detected");
        }

        // Epoch millisecond times
        const startDate = event.queryStringParameters.startDate;
        const endDate = event.queryStringParameters.endDate;
        const identifier = event.queryStringParameters.identifier;

        if (!startDate || !endDate || !identifier) {
          return {
            statusCode: 400,
            headers: {},
            body: JSON.stringify(`Some query string params missing: ${event.queryStringParameters}`),
          };
        }

        const params: AWS.TimestreamQuery.Types.QueryRequest = {
          QueryString: `
            SELECT identifier, measure_value::varchar AS cpu, concat(to_iso8601(time), 'Z') AS time 
            FROM "${process.env.TS_DB_NAME}"."${process.env.TS_TABLE_NAME}" 
            WHERE identifier = '${identifier}'
            AND time BETWEEN ${getDateRange(startDate)} 
            AND ${getDateRange(endDate)}
            ORDER BY time DESC 
          `,
        };

        const results = await queryClient.query(params).promise();

        const historicalRows: ReturnRow[] = results.Rows.map((row) => {
          const rowDate = new Date(row.Data[2].ScalarValue ?? "0");
          return {
            identifier: row.Data[0].ScalarValue,
            cpu: row.Data[1].ScalarValue ?? "0",
            time: rowDate.getTime(),
          };
        });

        const futureRows: ReturnRow[] = [];

        if (!historicalRows.length || new Date(historicalRows[0].time ?? 0).getTime() < parseInt(endDate)) {
          const dynamoQueryParams = {
            TableName: process.env.FUTURE_TABLE ?? "",
            KeyConditionExpression: "#pc = :id and #sc Between :begin and :end",
            ExpressionAttributeNames: {
              "#pc": "identifier",
              "#sc": "time",
            },
            ExpressionAttributeValues: {
              ":id": identifier,
              ":begin": Math.round(parseInt(startDate) / 1000),
              ":end": Math.round(parseInt(endDate) / 1000),
            },
          };

          const docClient = new AWS.DynamoDB.DocumentClient();
          const result = await docClient.query(dynamoQueryParams).promise();

          result.Items?.map((item) => {
            futureRows.push({
              identifier: item.identifier,
              cpu: item.value,
              time: item.time * 1000, // stored in seconds
            });
          });
        }

        const body = {
          historicalRows,
          futureRows,
        };

        return {
          statusCode: 200,
          headers: {},
          body: JSON.stringify(body),
        };
      }
    }

    console.log(`${method} detected instead of a GET`);
    // We only accept GET for now
    return {
      statusCode: 400,
      headers: {},
      body: "We only accept GET /timeSeries-data",
    };
  } catch (error) {
    console.log(error);
    const body = JSON.stringify(error, null, 2);
    return {
      statusCode: 400,
      headers: {},
      body: JSON.stringify(body),
    };
  }
};
