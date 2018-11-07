"use strict";

/******************************************************************************************

Routes for worker webhooks

******************************************************************************************/

const _ = require("lodash");

const { Engage } = require("../api/engage");
const { Bullhorn } = require("../api/bullhorn");
const mapper = require("../api/mapper");

var log = null;

const BH_UK_ADDR_DATA = { "address": { "countryID": 2359 } };

// TODO hardcoded for now
function addCountryInfoToPayload(data) {
	return _.merge(data, BH_UK_ADDR_DATA);
}

function updateCandidate(bullhornConfig, workerData, id) {

	Bullhorn.createOrGet(bullhornConfig).getEntity("Candidate", id, ["id"]).then(([status]) => {
		if (status === 200) {
			const data = mapper.workerToCandidate(bullhornConfig, workerData);
			const dataWithCountry = addCountryInfoToPayload(data);
			Bullhorn.createOrGet(bullhornConfig)
				.updateEntity("Candidate", id, dataWithCountry).then(([status, response]) => {
					if (status === 200)
						log.info(`Candidate ${ id } updated`);
					else
						log.warn(`Could not update candidate ${ id }. Status is ${ status }, ${ JSON.stringify(response, null, 4) }`);
				});
		}
		else
			log.info(`Not updating a non existing candidate (id: ${ id })`);

	});
}

function workerUpdated(integrationConfig, { id }) {
	log.info("Handling worker update ", id);
	new Engage(integrationConfig).getWorker(id).then(([status, worker]) => {
		if (status === 200) {
			log.info(`Fetched worker ${ worker.EmployeeId }`);
			const id = worker.EmployeeId.replace(integrationConfig.bullhorn.workerPrefix, "");
			updateCandidate(integrationConfig.bullhorn, worker, id);
		} 
		else
			log.warn(`Could not find worker ${ id }. Status code: ${ status }`);
	}).catch((error) => {
		log.warn(`Cannot fetch worker ${ id }. Error: ${ error }`);
	});
}

module.exports = {
	configure: (integrationConfig) => {
		log = integrationConfig.getLogUtils().log;
	},
	workerUpdated: workerUpdated
};
