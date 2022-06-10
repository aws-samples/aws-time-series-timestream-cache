import AWS = require("aws-sdk");
import { handler } from "./api-index";

AWS.config.region = "us-west-2";

// To run locally
// TS_DB_NAME=TimeSeriesDB TS_TABLE_NAME=identifierTimeSeriesHistory FUTURE_TABLE=TimeSeriesStack-TimeSeriesTable<tableID> API_SSM_ID=ExposedAPIKey  npx ts-node local.ts

const result = handler(
  {
    httpMethod: "GET",
    path: "/timeSeries-data",
    headers: { "x-security-token": "No-Key-Provided" },
    queryStringParameters: { startDate: "1653936226691", endDate: "1654152221408", identifier: "11111" },
  } as any,
  {} as any,
  {} as any
);

if (result) {
  result.then((x: any) => console.log(x));
}
