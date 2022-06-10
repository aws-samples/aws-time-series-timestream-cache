import AWS = require("aws-sdk");
import { spoofRecords } from "./timeSeries-index";
AWS.config.region = "us-west-2";

// To run locally
// npx ts-node local-spoof.ts
spoofRecords("foo");
