"use strict";

/******************************************************************************************

Routes for bullhorn polling

******************************************************************************************/

const cron = require("node-cron");
const _ = require("lodash");

const { Bullhorn } = require("../api/bullhorn");

const datastore = require("../datastore/main").createOrGet();

const workers = require("../common/workers");
const vacancies = require("./vacancies");
const placements = require("./placements");

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
			log.info(`Fetched ${ updates.length } status placement update(s) from datastore`);
			updates.forEach(({ id }) => {
				log.info(`Checking if placement ${ id } is in accepted status`);
				bullhorn.searchEntity("Placement", ["id", "status", "candidate"], `id:${ id } AND status:Approved`).then(([, response]) => {
					if (response.data.length) {
						response.data.forEach((updatedPlacement) => {
							const candidateId = updatedPlacement.candidate.id;
							workers.getOrCreateWorker(integrationConfig, candidateId, () => clearDatastoreUpdate(id)).then(() => {
							}).catch((error) => {
								log.warn(`Could not create worker for candidate id ${ candidateId }. Error: ${ error }`);
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

		vacancies.configure(integrationConfig);
		workers.configure(integrationConfig);
		placements.configure(integrationConfig);

		datastore.getAllIntegrations().then((integrations) => {
			integrations.forEach((integration) => {
				log.info(`Scheduling integration with id ${ integration.id } (${ integration.name })`);
				cron.schedule(integration.bullhorn.cronSchedule, createPoller(integration));
				cron.schedule(integration.bullhorn.cronSchedule, vacancies.createJobOrderPoller(integration));
				cron.schedule(integration.bullhorn.cronSchedule, placements.createPlacementsPoller(integration));
			});
		});

	}
};
