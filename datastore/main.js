"use strict";

const config = require("../config");

const { DynamoDataStore } = require("./dynamo");

var datastore; 

function initDataStore() {
	if (config.datastore.type === "dynamodb")
		datastore = new DynamoDataStore(config.datastore.params);
}

function createOrGet() {
	if (!datastore)
		initDataStore();

	return datastore;
}

module.exports = {
	createOrGet: createOrGet
};
