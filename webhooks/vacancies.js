"use strict";

const { Engage } = require("../api/engage");
const { Bullhorn } = require("../api/bullhorn");

const datastore = require("../datastore/main").createOrGet();

var log = null;

const VACANCY_VENDOR_INVITED = "vac:ven:inv";

function clearDatastoreEntry(id) {
	datastore.deleteEntityUpdate(VACANCY_VENDOR_INVITED, id).then(() => {
		log.info(`Vacancy vendor invitation ${ id } removed from datastore`);
	});
}

function fetchVacancyAndCreateJobOrder(integrationConfig, bullhorn, id) {
	const engage = new Engage(integrationConfig);

	engage.getVacancy(id).then(([status, response]) => {
		if (status === 200) {
			const managerEmail = response.hiringManager.email; // TODO ensure these cannot be null
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

						log.info(`Creating JobOrder ${ payload } `);
						bullhorn.createEntity("JobOrder", payload).then(([status]) => {
							if (status === 200) {
								log.info(`JobOrder created successfully for vacancy ${ id }`);
								clearDatastoreEntry(id);
							}
						});
					} 
					else {
						log.warn(`No ClientContacts for ${ managerEmail } are present. JobOrder cannot be created. Removing update from datastore`);
						clearDatastoreEntry(id);
					}
				}
				else {
					log.warn(`Could not fetch ClientContacts for ${ managerEmail }, response status is ${ status }`);
					clearDatastoreEntry(id);
				}
			});
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
			else
				log.info(`Not creating vacancy as there are existing ones for ${ extId }`);
		}
		else {
			log.warn(`Could not search JobOrders for ${ extId }. Status code is ${ status }`);
			clearDatastoreEntry(id);
		}
	});
}

function processUnprocessedItems(integrationConfig) {
	log.info("Processing stale vendor invited items");
	datastore.findEntityUpdates(VACANCY_VENDOR_INVITED).then((invitations) => {
		invitations.forEach(({ id }) => {
			processVacancyVendorInvitation(integrationConfig, id);
		});
	});
}

function idToExternalId(id) {
	return "ENG-" + id;
}

function vacancyVendorInvited(integrationConfig, { id }) {

	log.info(`Handling vendor invitation for vacancy ${ id }`);

	// TODO when?
	// processUnprocessedItems(integrationConfig); 

	datastore.upsertEntityUpdate(VACANCY_VENDOR_INVITED, id).then(() => {
		processVacancyVendorInvitation(integrationConfig, id);
	}).catch((response) => {
		log.error(response);
	});
}

module.exports = {
	configure: (integrationConfig) => {
		log = integrationConfig.getLogUtils().log;
	},
	vacancyVendorInvited: vacancyVendorInvited
};
