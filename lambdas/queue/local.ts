import AWS = require("aws-sdk");
import { handler } from "./queue-index";
AWS.config.region = "us-west-2";

// To run locally
// IDENTIFIER_QUEUE=https://sqs.us-west-2.amazonaws.com/<yourAccountNumber>/TimeSeriesStack-IdentifierQueue<sqs QueueID> IDENTIFIER_TABLE=TimeSeriesStack-IdentifierTable<TableID> npx ts-node local.ts
handler();
