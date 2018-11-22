"use strict";

/******************************************************************************************

Placements poller

******************************************************************************************/

const _ = require("lodash");

const { Bullhorn } = require("../api/bullhorn");
const { Engage } = require("../api/engage");

const datastore = require("../datastore/main").createOrGet();

const PLACEMENT_INSERT = "plac:ins";

const PLACEMENT_SUBSCRIPTION_EVENT = "placementInsert";

var log = null;

// ---- Utils -----

function clearDatastoreUpdate(id) {
	datastore.deleteEntityUpdate(PLACEMENT_INSERT, id).then(() => {
		log.info(`Removed placement insertion ${ id } from datastore`);
	});
}

function getUniqueJobSubmissionIds(subscriptionData) {
	return _.chain(subscriptionData.events)
		.map((event) => event.entityId)
		.uniq()
		.value();
}

function pollAndStoreUpdates(integrationConfig) {
	log.info(`Polling placement insertions for ${ integrationConfig.name }`);
	const bullhorn = Bullhorn.createOrGet(integrationConfig.bullhorn);
	bullhorn.getSubscriptionData(PLACEMENT_SUBSCRIPTION_EVENT).then(([status, response]) => {
		log.info(`Got ${ response.events && response.events.length } placement insertions (http status ${ status }) for subscription '${ PLACEMENT_SUBSCRIPTION_EVENT }'`);
		const ids = getUniqueJobSubmissionIds(response);
		log.info(`Filtered plamcents are ${ ids.length }`); // TODO filtering is probably redundant
		ids.forEach((id) => {
			datastore.upsertEntityUpdate(PLACEMENT_INSERT, id).then(() => {
				log.info(`Persisted placement creation ${ id }`);
			});
		});
	});
}

function isEngageJobOrder(externalId) {
	return externalId && _.isString(externalId) && externalId.startsWith("ENG-");
}

function parseEngageExternalId(externalId) {
	return Number(externalId.replace("ENG-", ""));
}

function placeMatchingProspects(integrationConfig, placementId, candidateId, prospects) {
	const prefixedId = integrationConfig.bullhorn.workerPrefix + candidateId;
	const matchingProspects = _.chain(prospects)
		.filter((p) => prefixedId === p.personExternalId)
		.value();

	if (matchingProspects.length !== 1)
		log.warn(`Expected matching prospect count to be 1, but found ${ matchingProspects.length } for placement id ${ placementId }`);
	else
		log.info(`Found ${ matchingProspects.length } matching prospects for placement id ${ placementId }`);

	const engage = new Engage(integrationConfig);

	matchingProspects.forEach(({ id, personExternalId }) => {
		log.info(`Setting prospect ${ id } (worker ${ personExternalId }) placement status to confirmed`);
		engage.updateProspectStatus(id, "CONFIRMED").then(([status, response]) => {
			if (status === 204) {
				log.info(`Worker's ${ personExternalId } (prospect ${ id }) status was successfully set to confirmed. Removing from datastore`);
				clearDatastoreUpdate(placementId);
			}
			else 
				log.warn(`Unexpected status ${ status } (response: ${ JSON.stringify(response) }) when setting worker ${ personExternalId } (prospect ${ id }) to confirmed.`);
		});
	});
}

function processUpdate(integrationConfig, placement) {
	const externalId = placement.jobOrder.externalID;
	if (isEngageJobOrder(externalId)) {
		const engage = new Engage(integrationConfig);
		log.info(`Fetching vacancy prospects for ${ externalId }`);
		engage.getVacancyProspects(parseEngageExternalId(externalId)).then(([status, response]) => {
			if (status === 200)
				placeMatchingProspects(integrationConfig, placement.id, placement.candidate.id, response);
			else
				log.warn(`Fetching vacancy prospects returned HTTP ${ status }`);
		});
	}
	else {
		log.info(`Not an engage placement ${ placement.id }. Removing from datastore`);
		clearDatastoreUpdate(placement.id);
	} 
}

function processUpdates(integrationConfig) {
	const bullhorn = Bullhorn.createOrGet(integrationConfig.bullhorn);

	datastore.findEntityUpdates(PLACEMENT_INSERT).then((updates) => {
		log.info(`Fetched ${ updates.length } placement insertions from datastore`);
		updates.forEach(({ id }) => {
			bullhorn.getEntity("Placement", id, ["id", "candidate", "jobOrder(externalID)"])
				.then(([status, response]) => {
					if (status == 200)
						processUpdate(integrationConfig, response.data);
					else {
						log.warn(`Got http ${ status } for JobSubmission ${ id }. Removing from datastore`);
						clearDatastoreUpdate(id);
					}
				});
		});
	});
}

function createPlacementsPoller(integrationConfig) {
	return () => {
		pollAndStoreUpdates(integrationConfig);
		processUpdates(integrationConfig);
	};
}

module.exports = {
	configure: (integrationConfig) => {
		log = integrationConfig.getLogUtils().log;
	},
	createPlacementsPoller: createPlacementsPoller
};

