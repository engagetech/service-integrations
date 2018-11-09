"use strict";

/******************************************************************************************

Routes for bullhorn polling

******************************************************************************************/

const cron = require("node-cron");
const _ = require("lodash");

const { Bullhorn } = require("../api/bullhorn");
const { Engage } = require("../api/engage");
const mapper = require("../api/mapper");

const datastore = require("../datastore/main").createOrGet();

const PLACEMENT_UPDATED_STATUS = "plac:status:up";

var log = null;

function getPlacementIdsWithStatusChanges(subscriptionData) {
	if (subscriptionData && subscriptionData.events) {
		return _.chain(subscriptionData.events)
			.filter((event) => {
				return event.entityName === "Placement" && _.includes(event.updatedProperties, "status");
			})
			.map((event) => event.entityId)
			.uniq()
			.value();
	}
	return [];
}

function clearDatastoreUpdate(id) {
	datastore.deleteEntityUpdate(PLACEMENT_UPDATED_STATUS, id).then(() => {
		log.info(`Removed placement ${ id } status update from datastore`);
	});
}

function convertAndCreateWorker(integrationConfig, placementId, candidate) {
	const workerPayload = mapper.candidateToWorker(integrationConfig.bullhorn, candidate);
	log.info(`Converted candidate ${ candidate.id } to worker ${ workerPayload.EmployeeId }`);
	const engage = new Engage(integrationConfig);
	engage.createWorker(workerPayload)
		.then(([status, response]) => {
			if (status === 200) {
				log.info(`Engage worker ${ response.EmployeeId } created`);
				const id = response.EmployeeId;
				const payload = {
					action: "notification",
					type: "registration",
					data: {
						"email": true,
						"sms": true
					}
				};
				log.info(`Triggering registration notification for ${ id }`);
				engage.triggerAction(id, payload).then(() => { });
				// avoid reprocessing if notifications fail
				clearDatastoreUpdate(placementId);
			}
			else {
				// will happen in cases like duplicate emails etc.
				log.warn("Cannot register worker", response);
				clearDatastoreUpdate(placementId);
			}
		})
		.catch((error) => {
			log.error("Error creating worker", error);
		});
}

function processUpdate(integrationConfig, placementId, payload) {
	if (payload && payload.data) {
		const candidate = payload.data;

		const prefix = integrationConfig.bullhorn.workerPrefix;
		const engage = new Engage(integrationConfig);
		const id = prefix + candidate.id;
		engage.getWorker(id).then(([status]) => {
			if (status === 404)
				convertAndCreateWorker(integrationConfig, placementId, candidate);
			else if (status === 200) {
				log.info(`Worker already exists for id ${ id }`);
				clearDatastoreUpdate(placementId);
			}
			else
				log.warn(`Unexpected status code when fetching worker: ${ status }`);
		}).catch((error) => {
			log.warn(`Cannot fetch worker by id ${ id }. ${ error }`);
		});
	}
}

// Debounced polling of bullhorn candidates endpoint
function createPoller(integrationConfig) {
	return () => {
		log.info(`Polling placement status updates for ${ integrationConfig.name }`);
		const bullhorn = Bullhorn.createOrGet(integrationConfig.bullhorn);
		bullhorn.getSubscriptionData("placementUpdate").then(([status, response]) => {
			log.info(`Got ${ response.events && response.events.length } placement updates (http status ${ status }) for subscription 'placementUpdate'`);
			const ids = getPlacementIdsWithStatusChanges(response);
			log.info(`Placements that have updated status are ${ ids.length }`);
			ids.forEach((id) => {
				datastore.upsertEntityUpdate(PLACEMENT_UPDATED_STATUS, id).then(() => {
					log.info(`Persisted status update for placement ${ id }`);
				});
			});
		});

		datastore.findEntityUpdates(PLACEMENT_UPDATED_STATUS).then((updates) => {
			log.info(`Fetched ${ updates.length } status placement update(s) for processing`);
			updates.forEach(({ id }) => {
				log.info(`Checking if placement ${ id } is in accepted status`);
				bullhorn.searchEntity("Placement", ["id", "status", "candidate"], `id:${ id } AND status:Approved`).then(([, response]) => {
					if (response.data.length) {
						response.data.forEach((updatedPlacement) => {
							const candidateId = updatedPlacement.candidate.id;
							bullhorn.getEntity("Candidate", candidateId, integrationConfig.bullhorn.candidateFields).then(([, candidate]) => {
								log.info(`Fetched candidate for updated placement with candidate id ${ candidateId }`);
								processUpdate(integrationConfig, id, candidate);
							});
						});
					} 
					else {
						log.info(`The placement ${ id } is not in accepted status. Removing from datastore.`);
						clearDatastoreUpdate(id);
					}
				});
			});
		}).catch((error) => {
			log.error(`Error searching for placement updates: ${ error }`);
		});
	};
}

module.exports = {
	addPollers: (integrationConfig) => {
		log = integrationConfig.getLogUtils().log;

		datastore.getAllIntegrations().then((integrations) => {
			integrations.forEach((integration) => {
				log.info(`Scheduling integration with id ${ integration.id } (${ integration.name })`);
				cron.schedule(integration.bullhorn.cronSchedule, createPoller(integration));
			});
		});

	}
};
