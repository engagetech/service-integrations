"use strict";

const AWS = require("aws-sdk");
const Promise = require("bluebird");

class DynamoDataStore {

	constructor(config) {
		AWS.config.setPromisesDependency(Promise);
		AWS.config.update(config);

		this.dynamodb = new AWS.DynamoDB();
		this.docClient = new AWS.DynamoDB.DocumentClient();
	}

	/**
	 * Adds a record indicating this entity will have to be processed
	 * @param {String} entity candidate etc.
	 * @param {number} id the id of the
	 * @param {Object} data additional information to store
	 * @returns {Promise} Nothing should be expected as a return
	 */
	upsertEntityUpdate(entity, id, data = {}) {
		const params = {
			TableName: "EntityUpdates",
			Item: {
				"entity": entity,
				"id": id,
				// added as a potential debugging info
				// clients should not expect this to exist
				"data": data
			}
		};
		return this.docClient.put(params).promise();
	}

	/**
	 * Removes a record that has been processed
	 * @param {String} entity candidate etc.
	 * @param {number} id the id of the
	 * @returns {Promise} Nothing should be expected as a return
	 */
	deleteEntityUpdate(entity, id) {
		const params = {
			TableName: "EntityUpdates",
			Key: {
				"entity": entity,
				"id": id
			}
		};
		return this.docClient.delete(params).promise();
	}

	/**
	 * All records that have to be processed for the given entity.
	 * Datastore will provide the following data [ { entity: 'candidate', id: 72 } ]
	 * @param {string} entity The entity to query updates for e.g. candidate 
	 * @returns {Promise} A promise of all the updates for the given entity
	 */
	findEntityUpdates(entity) {
		const params = {
			TableName: "EntityUpdates",
			KeyConditionExpression: "entity = :entity",
			ExpressionAttributeValues: {
				":entity": entity
			}
		};
		return this.docClient.query(params).promise().then((response) => {
			return Promise.resolve(response.Items);
		});
	}

	/**
	 * Configurations format:
	 * [{ name: "Foo", engageExternalApi: "http://localhost:8000", bullhorn: [Object], ... }]
	 * @returns {Promise} A promise of all active configurations
	 */
	getAllIntegrations() {
		const params = {
			TableName: "Integrations"
		};
		return this.docClient.scan(params).promise().then((response) => {
			// simplify the data format provided to clients
			response.Items.forEach((integration) => {
				integration.bullhorn.candidateFields = integration.bullhorn.candidateFields.values;
				integration.bullhorn.jobSubmissionSyncStatuses = integration.bullhorn.jobSubmissionSyncStatuses.values;
			});
			return Promise.resolve(response.Items);
		});
	}
}

module.exports = {
	DynamoDataStore: DynamoDataStore
};
