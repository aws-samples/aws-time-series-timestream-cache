import AWS = require("aws-sdk");
import { handler } from "./timeSeries-index";
AWS.config.region = "us-west-2";

// To run locally
// TS_DB_NAME=TimeSeriesDB TS_TABLE_NAME=identifierTimeSeriesHistory FUTURE_TABLE=TimeSeriesStack-TimeSeriesTable<TableId> API_KEY_SSM_ID=CachedAPIKey npx ts-node local.ts
handler({ Records: [{ body: '{"identifiers":["2549","2617"]}' } as any] }, {} as any, {} as any);
