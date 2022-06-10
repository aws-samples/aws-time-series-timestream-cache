import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { TimeSeriesStack } from "../cdk/stacks/timeSeries-stack";

const app = new cdk.App();

new TimeSeriesStack(app, "TimeSeriesStack");
