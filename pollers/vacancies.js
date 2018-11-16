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

const JOB_SUBMISSION_UPDATE = "jobsub:up";

const JOB_SUBSCRIPTION_EVENT = "jobSubmissionUpdate";

var log = null;

function getUniqueJobSubmissionIds(subscriptionData) {
	return _.chain(subscriptionData.events)
		.map((event) => event.entityId)
		.uniq()
		.value();
}

function pollAndStoreUpdates(integrationConfig) {
	log.info(`Polling job submission updates for ${ integrationConfig.name }`);
	const bullhorn = Bullhorn.createOrGet(integrationConfig.bullhorn);
	bullhorn.getSubscriptionData(JOB_SUBSCRIPTION_EVENT).then(([status, response]) => {
		log.info(`Got ${ response.events && response.events.length } job submission updates (http status ${ status }) for subscription '${ JOB_SUBSCRIPTION_EVENT }'`);
		const ids = getUniqueJobSubmissionIds(response);
		log.info(`Filtered job submission ids are ${ ids.length }`);
		ids.forEach((id) => {
			datastore.upsertEntityUpdate(JOB_SUBMISSION_UPDATE, id).then(() => {
				log.info(`Persisted job submission update ${ id }`);
			});
		});
	});
}

function clearDatastoreUpdate(id) {
	datastore.deleteEntityUpdate(JOB_SUBMISSION_UPDATE, id).then(() => {
		log.info(`Removed job submission update ${ id } datastore`);
	});
}

function isEngageJobOrder(exteranId) {
	return exteranId && _.isString(exteranId) && exteranId.startsWith("ENG-");
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

function calculateAndFormatEndDate({ startDate, dateEnd, durationWeeks }) {
	if (dateEnd)
		return timestampToDate(dateEnd);
	else {
		const weeks = durationWeeks || 52;
		return timestampToDate(addDays(startDate, Math.ceil(durationWeeks * weeks)));
	}
}

function parseEngageExternalId(exteranId) {
	return Number(exteranId.replace("ENG-", ""));
}

const data = {
    "data": {
        "id": 43,
        "candidate": {
            "id": 86,
            "firstName": "Wizzard",
            "lastName": "1"
        },
        "status": "CV Sent",
        "jobOrder": {
            "id": 52,
            "title": "Snr UX Designer",
            "externalID": "ENG-5911",
            "startDate": 1542258000000,
            "dateEnd": null,
            "durationWeeks": 2,
            "payRate": 0,
            "clientBillRate": null
        },
        "payRate": null
    }
}

function submitWorkerToPlacement(integrationConfig, jobSubmission) {
	workers.getOrCreateWorker(integrationConfig, jobSubmission.candidate.id, () => clearDatastoreUpdate(jobSubmission.id)).then((worker) => {

		const payload = {
			"personId": worker.Id,
			"vacancyDetailId": parseEngageExternalId(jobSubmission.jobOrder.externalID),
			"finishDate": calculateAndFormatEndDate(jobSubmission.jobOrder),
			"startDate": timestampToDate(jobSubmission.jobOrder.startDate),
			"rates": [
				{
					"name": "rate",
					"payRate": jobSubmission.jobOrder.payRate,
					"chargeTotal": jobSubmission.jobOrder.clientBillRate || 0,
					"payType": "CONTRACT", // TODO find out the type
					"rateType": "HOURLY" // TODO

				}
			]
		};

		const engage = new Engage(integrationConfig);
		engage.placeWorker(payload).then(([status, response]) => {
			if (status === 201)
				log.info(`Worker ${ worker.Id } was placed successfully to placement ${ response.id }`);
			else {
				log.info(`Could not place worker. Http code ${ status }. Response: ${ response.message }. Removing update from datastore`);
				clearDatastoreUpdate(jobSubmission.id); 
			}
		});

	}).catch((error) => {
		log.warn("Cannot submit worker to placement: " + error);
	});
}

function processJobSubmission(integrationConfig, jobOrderId, externalID, placementId) {
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

function processUpdate(integrationConfig, jobSubmission) {
	log.info(`Processing JobSubmission ${ jobSubmission.id }`);
	if (!jobSubmission.jobOrder) {
		log.warn(`JobSubmission ${ jobSubmission.id } has no JobOrder. Removing from datastore`);
		clearDatastoreUpdate(jobSubmission.id);
	}
	else if (!isEngageJobOrder(jobSubmission.jobOrder.externalID)) {
		log.info(`JobOrder ${ jobSubmission.id } is not from Engage. Removing from datastore`);
		clearDatastoreUpdate(jobSubmission.id);
	}
	else {
		// TODO add check to status
		submitWorkerToPlacement(integrationConfig, jobSubmission);
	}
}

function processUpdates(integrationConfig) {
	const bullhorn = Bullhorn.createOrGet(integrationConfig.bullhorn);

	datastore.findEntityUpdates(JOB_SUBMISSION_UPDATE).then((updates) => {
		log.info(`Fetched ${ updates.length } job submission update(s) for datastore`);
		updates.forEach(({ id }) => {
			bullhorn.getEntity("JobSubmission", id, ["id", "candidate", "status", "jobOrder(externalID, startDate, dateEnd, durationWeeks, payRate, clientBillRate)"])
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
