# Time series cache with Amazon Timestream

This project is an example of a time series caching service that stores historical and future data from a source into Amazon DynamoDB and Amazon Timestream. The data is then either accessed internally or exposed via an example API.

Tech:

- Amazon Timestream
- Amazon DynamoDB
- Amazon SQS
- AWS Lambda
- AWS Systems Manager
- Amazon API Gateway.

## Solution Architecture

![Solution Design](/readme//solution.png)

### Data storage flow:

1. Cron trigger launches queuing lambda
2. Queueing lambda grabs id's from DynamoDB and places them into SQS
3. SQS triggers API fetch lambda (fan out)
4. API fetch lambda grabs data from external API
5. Past data is placed into Timestream
6. Future data is placed into DynamoDB

### Data retrieval flow:

1. A query is made through API gateway. [\*](#api-gateway-implementation)
2. API handler function is triggered with query string parameters and sets upper and lower bounds for time.
3. Past records are retrieved from Timestream
4. The rest of the records (using the last Timestream timestamp as a baseline) are retrieved from DynamoDB
5. Data is returned in a uniform format.

### What's not noted here

- Iam
- Cloudwatch

## Getting started

### Prerequisites:

- [yarn/npm](https://classic.yarnpkg.com/lang/en/docs/install/)
- [aws cdk cli](https://docs.aws.amazon.com/cdk/v2/guide/cli.html)
- [aws cli](https://aws.amazon.com/cli/)
- [Docker](https://www.docker.com/get-started/)

### Standing up:

First:

- Ensure docker engine is running
- Authenticate your shell session with your desired AWS account and region.

_Note: ensure the region you are deploying to supports Timestream._

Then run:

```
yarn
cdk deploy
```

This may take around 5-10 minutes to deploy initially. Other updates will be faster.

### Hydration and testing

Running the below script from root should test the whole solution once it's stood up to make sure everything connected properly.

1. It will add an identifier to the ID table and kick off the lambda.
2. It will check the API to see if the data is hydrated properly.

If everything goes well, it should take less than a second to hydrate through the system.

Some of these are default values. You will need to add the table name and API route. If you have changed any other values update them as needed also.

```bash
API_ENDPOINT=https://yourendpoint/prod/ \
ID_TABLE=dynamo-db-table-name \
API_KEY=No-Key-Provided \
QUEUE_LAMBDA_NAME=Lambda-queue-index \
npx ts-node e2eTest/hydration.ts
```

You should see the below message:

```
Rows found in API:  288
Everything is hooked up!
```

If there is a error then hopefully there should be enough information to debug the problem.

## Notes

### The way the lambdas are structured

In this sample repository the lambdas do not have their own `package.json` or `node_modules`, this will cause the created lambdas to include the top-level `node_modules`. This isn't a problem for this particular solution but eventually that package may be too large even for lambda. You can fix that by adding in a `package.json` for each lambda and generating a `node_modules`.

### API Gateway implementation

The API Gateway implementation is not meant to be a complete example of a lambda API attached to API Gateway, recommended security practices and frameworks have not been included. It is intended to be an example of how retrieval can be achieved via a method similar to this.

### local.ts files

There are several local.ts files with comments within. These files are used to test the lambda functions on your own machine while pointing at resources in AWS.

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
