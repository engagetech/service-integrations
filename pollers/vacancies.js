"use strict";

/******************************************************************************************

Vacancies/JobOrder poller

******************************************************************************************/

const _ = require("lodash");

const { Bullhorn } = require("../api/bullhorn");
const { Engage } = require("../api/engage");
const Promise = require("bluebird");
const mapper = require("../api/mapper");
const workers = require("../common/workers");

const datastore = require("../datastore/main").createOrGet();

const JOB_ORDER_UPDATE = "joborder:up";

var log = null;

function getUniqueJobOrderIds(subscriptionData) {
	return _.chain(subscriptionData.events)
		.map((event) => event.entityId)
		.uniq()
		.value();
}

function pollAndStoreUpdates(integrationConfig) {
	log.info(`Polling job order updates for ${ integrationConfig.name }`);
	const bullhorn = Bullhorn.createOrGet(integrationConfig.bullhorn);
	bullhorn.getSubscriptionData("jobOrderUpdate").then(([status, response]) => {
		log.info(`Got ${ response.events && response.events.length } job order updates (http status ${ status }) for subscription 'jobOrderUpdate'`);
		const ids = getUniqueJobOrderIds(response);
		log.info(`Filtered job order ids are ${ ids.length }`);
		ids.forEach((id) => {
			datastore.upsertEntityUpdate(JOB_ORDER_UPDATE, id).then(() => {
				log.info(`Persisted job order update ${ id }`);
			});
		});
	});
}

function clearDatastoreUpdate(id) {
	datastore.deleteEntityUpdate(JOB_ORDER_UPDATE, id).then(() => {
		log.info(`Removed job order update ${ id } datastore`);
	});
}

function isEngageJobOrder(exteranId) {
	return exteranId && _.isString(exteranId) && exteranId.startsWith("ENG-");
}

function ensureWorkerExists(integrationConfig, candidateId) {
	const prefix = integrationConfig.bullhorn.workerPrefix;
	const engage = new Engage(integrationConfig);
	const id = prefix + candidateId;

	return engage.getWorker(id).then(([status, response]) => {

		log.info(`Enage worker for ${ id } check returned http status ${ status }`);
		if (status === 404)
			return Promise.reject("TODO"); // TODO
		else
			return Promise.resolve(response.Id);
	});
}

function timestampToDate(timestamp) {
	const d = new Date(timestamp);
	return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

function addDays(timestamp, days) {
	var date = new Date(timestamp);
	date.setDate(date.getDate() + days);
	return date;
}

function calculateAndFormatEndDate({ dateBegin, dateEnd, durationWeeks }) {
	if (dateEnd)
		return timestampToDate(dateEnd);
	else {
		const weeks = durationWeeks || 52;
		return timestampToDate(addDays(dateBegin, Math.ceil(durationWeeks * weeks)));
	}
}

function parseEngageExternalId(exteranId) {
	return Number(exteranId.replace("ENG-", ""));
}

function submitWorkerToPlacement(integrationConfig, jobOrderId, externalId, placement) {
	workers.getOrCreateWorker(integrationConfig, placement.candidate.id, () => {}).then((id) => {

		const payload = {
			"personId": id,
			"vacancyDetailId": parseEngageExternalId(externalId),
			"finishDate": calculateAndFormatEndDate(placement),
			"startDate": timestampToDate(placement.dateBegin),
			"rates": [
				{
					"name": "rate",
					"payRate": placement.payRate,
					"chargeTotal": placement.clientBillRate,
					"payType": "CONTRACT", // TODO find out the type
					"rateType": "HOURLY" // TODO

				}
			]
		};

		const engage = new Engage(integrationConfig);
		engage.placeWorker(payload).then(([status, response]) => {
			if (status === 201)
				log.info(`Worker ${ id } was placed successfully to placement ${ response.id }`);
			else {
				log.info(`Could not place worker. Http code ${ status }. Response: ${ response.message }. Removing update from datastore`);
				clearDatastoreUpdate(jobOrderId)
			}
		});

	}).catch((error) => {
		log.warn("Cannot submit worker to placement: " + error);
	});
}

function processJobOrderPlacement(integrationConfig, jobOrderId, externalID, placementId) {
	const bullhorn = Bullhorn.createOrGet(integrationConfig.bullhorn);
	log.info(`Processing Placement ${ placementId } for JobOrder ${ jobOrderId }`);
	bullhorn.getEntity("Placement", placementId, ["id", "candidate", "dateBegin", "dateEnd", "durationWeeks", "payRate", "clientBillRate"])
		.then(([status, response]) => {
			log.info(`Fetched placement ${ placementId }, http status is ${ status }`);
			if (status === 200)
				submitWorkerToPlacement(integrationConfig, jobOrderId, externalID, response.data);
			else {
				log.info(`Fetching placement for id ${ placementId } resulted into http ${ status }. Removing update from datastore`);
				clearDatastoreUpdate(jobOrderId);
			}
		});
}

function processUpdate(integrationConfig, data) {
	log.info(`Processing JobOrder ${ data.id }`);
	if (!isEngageJobOrder(data.externalID)) {
		log.info(`JobOrder ${ data.id } is not from Engage. Removing from datastore`);
		clearDatastoreUpdate(data.id);
	}
	else if (data.placements.total === 0) {
		log.info(`JobOrder ${ data.id } has no placements. Removing from datastore`);
		clearDatastoreUpdate(data.id);
	}
	else {
		data.placements.data.forEach((placement) => {
			processJobOrderPlacement(integrationConfig, data.id, data.externalID, placement.id);
		});
	}
}

function processUpdates(integrationConfig) {
	const bullhorn = Bullhorn.createOrGet(integrationConfig.bullhorn);

	datastore.findEntityUpdates(JOB_ORDER_UPDATE).then((updates) => {
		log.info(`Fetched ${ updates.length } job order update(s) for datastore`);
		updates.forEach(({ id }) => {
			bullhorn.getEntity("JobOrder", id, ["id", "placements", "externalID"]).then(([status, response]) => {
				if (status == 200)
					processUpdate(integrationConfig, response.data);
				else {
					log.warn(`Got http ${ status } for JobOrder ${ id }. Removing from datastore`);
					clearDatastoreUpdate(id);
				}
			});
		});
	});
}

function createJobOrderPoller(integrationConfig) {
	return () => {
		pollAndStoreUpdates(integrationConfig);
		processUpdates(integrationConfig);
	};
}

module.exports = {
	configure: (integrationConfig) => {
		log = integrationConfig.getLogUtils().log;
	},
	createJobOrderPoller: createJobOrderPoller
};
