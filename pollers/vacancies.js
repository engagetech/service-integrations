"use strict";

/******************************************************************************************

Vacancies/JobOrder poller

******************************************************************************************/

const _ = require("lodash");

const { Bullhorn } = require("../api/bullhorn");
const { Engage } = require("../api/engage");
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

// TODO duplicated
function primaryOrFirstRate(rates) {
	const primaryRates = _.filter(rates, (r) => r.primary);
	if (primaryRates.length)
		return primaryRates[0];
	else
		return rates[0];
}

function submitWorkerToPlacement(integrationConfig, jobSubmission) {
	const engage = new Engage(integrationConfig);

	workers.getOrCreateWorker(integrationConfig, jobSubmission.candidate.id, () => clearDatastoreUpdate(jobSubmission.id)).then((worker) => {
		const vacancyId = parseEngageExternalId(jobSubmission.jobOrder.externalID);
		engage.getVacancy(vacancyId).then(([status, response]) => {
			if (status === 200) {
				log.info(`Fetched engage vacancy for ${ vacancyId } to get the the primary rate`);
				// by convention we pick the first or the primary
				const rate = primaryOrFirstRate(response.rates);
				const payload = {
					"personId": worker.Id,
					"vacancyDetailId": vacancyId,
					"finishDate": calculateAndFormatEndDate(jobSubmission.jobOrder),
					"startDate": timestampToDate(jobSubmission.jobOrder.startDate),
					"rates": [Object.assign(rate, { primary: true })] //make sure it's primary
				};

				engage.placeWorker(payload).then(([status, response]) => {
					if (status === 201)
						log.info(`Worker ${ worker.Id } was placed successfully. Submission id: ${ response.id }`);
					else {
						log.info(`Could not place worker. Http code ${ status }. Response: ${ response.message }. Removing update from datastore`);
						clearDatastoreUpdate(jobSubmission.id);
					}
				});
			}
			else
				log.warn(`Cannot fetch Engage vacancy ${ vacancyId }, status code ${ status }`);
		});
	}).catch((error) => {
		log.warn("Cannot submit worker to placement: " + error);
	});
}

function isSyncStatus(statuses, status) {
	return _.isEmpty(statuses) || _.includes(statuses, status);
}

function processUpdate(integrationConfig, jobSubmission) {
	const statuses = integrationConfig.bullhorn.jobSubmissionSyncStatuses;
	log.info(`Processing JobSubmission ${ jobSubmission.id }`);
	if (!jobSubmission.jobOrder) {
		log.warn(`JobSubmission ${ jobSubmission.id } has no JobOrder. Removing from datastore`);
		clearDatastoreUpdate(jobSubmission.id);
	}
	else if (!isEngageJobOrder(jobSubmission.jobOrder.externalID)) {
		log.info(`JobOrder ${ jobSubmission.id } is not from Engage. Removing from datastore`);
		clearDatastoreUpdate(jobSubmission.id);
	}
	else if (!isSyncStatus(statuses, jobSubmission.status)) {
		log.info(`Not a job submission status we are interested in ${ jobSubmission.status }. Removing from datastore`);
		clearDatastoreUpdate(jobSubmission.id);
	}
	else
		submitWorkerToPlacement(integrationConfig, jobSubmission);
}

function processUpdates(integrationConfig) {
	const bullhorn = Bullhorn.createOrGet(integrationConfig.bullhorn);

	datastore.findEntityUpdates(JOB_SUBMISSION_UPDATE).then((updates) => {
		log.info(`Fetched ${ updates.length } job submission update(s) from datastore`);
		updates.forEach(({ id }) => {
			bullhorn.getEntity("JobSubmission", id, ["id", "candidate", "status", "payRate", "billRate", "jobOrder(externalID, startDate, dateEnd, durationWeeks, payRate, clientBillRate, employmentType)"])
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
