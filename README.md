# service-integrations

> **Note:** Work in progress

A (possibly) temporary service for integrating Engage&#39;s public API with other SaaS platform APIs.


## Setup

First you need to setup the config files, prepare the db and create the necessary bullhorn subscrpitions


### Config 

Prepare the config file:

```sh
cp config.js.example config.js
```

and edit as needed.

Prepare the integration config file:

```sh
cp integration.json.example integration.json
```

get the API and user credentials from LP.


### Run a local dynamo db

Fetch a downloadable version of DynamoDB and follow the instructions
as described [here](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html).

An alternative way is to use docker:

```sh
docker run -p 8055:8000 amazon/dynamodb-local
```

> Note that docker data will be wiped as soon as the container is stopped

Create the necessary tables:

```sh
aws --endpoint-url http://localhost:8055 dynamodb create-table \
    --table-name Integrations \
    --attribute-definitions \
        AttributeName=name,AttributeType=S \
    --key-schema \
        AttributeName=name,KeyType=HASH \
    --provisioned-throughput \
        ReadCapacityUnits=10,WriteCapacityUnits=10
```

```sh
aws --endpoint-url http://localhost:8055 dynamodb create-table \
    --table-name EntityUpdates \
    --attribute-definitions \
        AttributeName=entity,AttributeType=S \
        AttributeName=id,AttributeType=N \
    --key-schema \
        AttributeName=entity,KeyType=HASH \
        AttributeName=id,KeyType=RANGE \
    --provisioned-throughput \
        ReadCapacityUnits=10,WriteCapacityUnits=10
```

Ensure the two tables are there:

```sh
aws --endpoint-url http://localhost:8055 dynamodb list-tables
```

Add an integration config:

```sh
aws --endpoint-url http://localhost:8055 dynamodb put-item \
    --table-name Integrations \
    --item file://integration.json
```

Note: Adding a config with the same name will replace the existing one

Check pending updates in the datastore:

```sh
aws --endpoint-url http://localhost:8055 dynamodb scan \
     --table-name EntityUpdates \
     --filter-expression "entity = :entity" \
     --expression-attribute-values '{":entity":{"S":"plac:status:up"}}'
```


### Setup subscriptions

Create the following subscription for modified `Placement`s: 

```
/event/subscription/placementUpdate?type=entity&names=Placement&eventTypes=UPDATED
```

Create the following subscription for created and modified `JobSubmissions`s: 

```
/event/subscription/jobSubmissionUpdate?type=entity&names=JobSubmission&eventTypes=UPDATED,INSERTED
```

See http://bullhorn.github.io/rest-api-docs/#put-event-subscription


## Running

Make sure `bunyan` is globally installed to get nice log messages:

```sh
npm i -g bunyan
```

Install `nodemon` to restart the server when a file is changed:

```sh
npm i -g nodemon
```

Run!

```sh
nodemon server.js | bunyan
```
