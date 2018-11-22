"use strict";

const cron = require("node-cron");

const { Engage } = require("../api/engage");
const { Bullhorn } = require("../api/bullhorn");

const datastore = require("../datastore/main").createOrGet();

var log = null;

const VACANCY_VENDOR_INVITED = "vac:ven:inv";
const VACANCY_SUBMISSION_ACCEPTED = "vac:sub:acc";
const VACANCY_SUBMISSION_REJECTED = "vac:sub:rej";

const ALL_EVENTS = [ VACANCY_VENDOR_INVITED, VACANCY_SUBMISSION_ACCEPTED, VACANCY_SUBMISSION_REJECTED ];

// ------ Utils ----

function clearDatastoreEntry(entity, id) {
	datastore.deleteEntityUpdate(entity, id).then(() => {
		log.info(`Entity ${ entity } ${ id } removed from datastore`);
	});
}

function idToExternalId(id) {
	return "ENG-" + id;
}

// ------ Event Processors ----

function fetchVacancyAndCreateJobOrder(integrationConfig, bullhorn, id) {
	const engage = new Engage(integrationConfig);

	engage.getVacancy(id).then(([status, response]) => {
		if (status === 200) {
			const managerEmail = response.hiringManager.email; 
			const title = response.tradeName; // TODO mapping
			log.info(`Fetched engage vacancy for id ${ id }. Fetching ClientContacts for ${ managerEmail }`);
			bullhorn.searchEntity("ClientContact", ["id", "clientCorporation"], "email:" + managerEmail).then(([status, response]) => {
				if (status === 200) {
					if (response.total > 0) {
						log.info(`Found ${ response.total } ClientContacts for ${ managerEmail }. Taking the first`);
						const contact = response.data[0];
						const contactId = contact.id;
						const corporationId = contact.clientCorporation.id;
						const externalId = idToExternalId(id);

						const payload = {
							"clientContact": { "id": contactId },
							"clientCorporation": { "id": corporationId },
							"title": title,
							"externalID": externalId
						};

						log.info(`Creating JobOrder ${ JSON.stringify(payload) } `);
						bullhorn.createEntity("JobOrder", payload).then(([status]) => {
							if (status === 200) {
								log.info(`JobOrder created successfully for vacancy ${ id }`);
								clearDatastoreEntry(VACANCY_VENDOR_INVITED, id);
							}
						});
					} 
					else {
						log.warn(`No ClientContacts for ${ managerEmail } are present. JobOrder cannot be created. Removing update from datastore`);
						clearDatastoreEntry(VACANCY_VENDOR_INVITED, id);
					}
				}
				else {
					log.warn(`Could not fetch ClientContacts for ${ managerEmail }, response status is ${ status }`);
					clearDatastoreEntry(VACANCY_VENDOR_INVITED, id);
				}
			});
		}
		else {
			log.warn(`Could not fetch engage vacancy for id ${ id }. Removing from datastore`);
			clearDatastoreEntry(VACANCY_VENDOR_INVITED, id);
		}
	});
}

function processVacancyVendorInvitation(integrationConfig, id) {

	const bullhorn = Bullhorn.createOrGet(integrationConfig.bullhorn);

	const extId = idToExternalId(id);
	log.info(`Vacancy vendor invitation ${ id } added to datastore. Fetching JobOrders for ${ extId }`);
	bullhorn.searchEntity("JobOrder", ["id"], "externalID:" + extId).then(([status, response]) => {
		if (status === 200) {
			log.info(`Found ${ response.total } JobOrder(s) for ${ extId }`);
			if (response.total === 0) 
				fetchVacancyAndCreateJobOrder(integrationConfig, bullhorn, id);
			else {
				log.info(`Not creating vacancy as there are existing ones for ${ extId }`);
				clearDatastoreEntry(VACANCY_VENDOR_INVITED, id);
			}
		}
		else {
			log.warn(`Could not search JobOrders for ${ extId }. Status code is ${ status }`);
			clearDatastoreEntry(VACANCY_VENDOR_INVITED, id);
		}
	});
}

const OFFER_EXTENDED = "Offer Extended";
const CLIENT_REJECTED = "Client Rejected";

function updateJobSubmissionStatus(integrationConfig, id, { workerId, vacancyId }, dsEntry, jobStatus) {
	if (!workerId || !vacancyId) {
		log.warn(`Worker id ${ workerId } or Vacancy id ${ vacancyId } cannot be null. Removing from datastore`);
		clearDatastoreEntry(dsEntry, id);
	}

	const candidateId = ("" + workerId).replace(integrationConfig.bullhorn.workerPrefix, "");
	const vacancyIdPrefixed = idToExternalId(vacancyId);

	const where = `jobOrder.externalID='${ vacancyIdPrefixed }' and candidate.id=${ candidateId }`;

	const bullhorn = Bullhorn.createOrGet(integrationConfig.bullhorn);
	bullhorn.queryEntity("JobSubmission", ["id", "jobOrder", "candidate"], where).then(([status, response]) => {
		if (status === 200) {
			if (response.count === 0) {
				log.warn(`No matching job submissions found for candidate ${ candidateId } and vacancy ${ vacancyIdPrefixed }`);
				clearDatastoreEntry(dsEntry, id);
			}
			else {
				if (response.count > 1)
					log.warn(`Got more than one job submission for candidate ${ candidateId } and vacancy ${ vacancyIdPrefixed }`);

				response.data.forEach((jobSubmission) => {
					log.info(`Updating job submission ${ jobSubmission.id }, Job Order ${ JSON.stringify(jobSubmission.jobOrder) }, candidate ${ JSON.stringify(jobSubmission.candidate) } setting status to '${ jobStatus }'`);
					bullhorn.updateEntity("JobSubmission", jobSubmission.id, { status: jobStatus }).then(([status]) => {
						if (status === 200) {
							log.info(`Job submission ${ jobSubmission.id } updated successfully`);
							clearDatastoreEntry(dsEntry, id);
						}
						else 
							log.warn(`Cannot update job submission ${ jobSubmission.id }. Status is ${ status }`);
					});
				});
			}
		}
		else {
			log.warn(`Querying job submission with where: ${ where } returned ${ status }. Removing from datastore`);
			clearDatastoreEntry(dsEntry, id);
		}
	});
}

function processVacancySubmissionAccepted(integrationConfig, id, data) {
	log.info(`Processing submission approval ${ id }, data = ${ JSON.stringify(data) }`);
	updateJobSubmissionStatus(integrationConfig, id, data, VACANCY_SUBMISSION_ACCEPTED, OFFER_EXTENDED);
}

function processVacancySubmissionRejected(integrationConfig, id, data) {
	log.info(`Processing submission rejection ${ id }, data = ${ JSON.stringify(data) }`);
	updateJobSubmissionStatus(integrationConfig, id, data, VACANCY_SUBMISSION_REJECTED, CLIENT_REJECTED);
}

// --- Hook handlers

function processUnprocessedItems(integrationConfig) {
	log.info("Processing vendor invitations");
	datastore.findEntityUpdates(VACANCY_VENDOR_INVITED).then((invitations) => {
		invitations.forEach(({ id }) => {
			processVacancyVendorInvitation(integrationConfig, id);
		});
	});
}

function vacancyVendorInvited(integrationConfig, { id }) {

	log.info(`Handling vendor invitation for vacancy ${ id }`);

	processUnprocessedItems(integrationConfig); 

	datastore.upsertEntityUpdate(VACANCY_VENDOR_INVITED, id).catch((response) => {
		log.error(response);
	});
}

function vacancySubmissionStatusChanged(integrationConfig, { id, workerId, submissionId, submissionStatus }) {
	if (submissionStatus === "ACCEPTED") {
		datastore.upsertEntityUpdate(VACANCY_SUBMISSION_ACCEPTED, submissionId, { "vacancyId": id, "workerId": workerId })
			.then(() => {});
	}
	else if (submissionStatus === "REJECTED") {
		datastore.upsertEntityUpdate(VACANCY_SUBMISSION_REJECTED, submissionId, { "vacancyId": id, "workerId": workerId })
			.then(() => {});
	} 
	else
		log.warn(`Not a vacancy submission status we are interested in: ${ submissionStatus }. Submission id ${ submissionId }`);
}

// TODO duplication
const HANDLER_MAPPINGS = {
	"vac:ven:inv": processVacancyVendorInvitation,
	"vac:sub:acc": processVacancySubmissionAccepted,
	"vac:sub:rej": processVacancySubmissionRejected
};

function createItemProcessor(integrationConfig) {
	return () => {
		ALL_EVENTS.forEach((event) => {
			datastore.findEntityUpdates(event).then((updates) => {
				log.info(`Processing ${ updates.length } update(s) for event ${ event }`);
				updates.forEach(({ entity, id, data }) => {
					const handler = HANDLER_MAPPINGS[entity];
					if (handler) {
						log.info(`Dispatching to handler for ${ entity } with id ${ id }`);
						handler(integrationConfig, id, data);
					}
					else
						log.warn(`No handler for ${ entity }`);
				});
			});
		});
	};
}

module.exports = {
	configure: (integrationConfig) => {
		log = integrationConfig.getLogUtils().log;

		datastore.getAllIntegrations().then((integrations) => {
			integrations.forEach((integration) => {
				cron.schedule(integration.bullhorn.cronSchedule, createItemProcessor(integration));
			});
		});
	},
	vacancyVendorInvited: vacancyVendorInvited,
	vacancySubmissionStatusChanged: vacancySubmissionStatusChanged
};
