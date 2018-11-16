"use strict";

const { Engage } = require("../api/engage");
const { Bullhorn } = require("../api/bullhorn");
const Promise = require("bluebird");
const mapper = require("../api/mapper");

var log = null;

function convertAndCreateWorker(integrationConfig, candidate, callback) {
	const workerPayload = mapper.candidateToWorker(integrationConfig.bullhorn, candidate);
	log.info(`Converted candidate ${ candidate.id } to worker ${ workerPayload.EmployeeId }`);
	const engage = new Engage(integrationConfig);
	return engage.createWorker(workerPayload)
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
				callback();
				return Promise.resolve(response);
			}
			else {
				// will happen in cases like duplicate emails etc.
				log.warn("Cannot register worker", response);
				callback();
				// TODO this should not happen given that we check for this at the beggining
				return Promise.reject(response.message);
			}
		})
		.catch((error) => {
			log.error("Error creating worker", error);
			return Promise.reject(error);
		});
}

function processUpdate(integrationConfig, payload, callback) {
	if (payload && payload.data) {
		const candidate = payload.data;

		const prefix = integrationConfig.bullhorn.workerPrefix;
		const engage = new Engage(integrationConfig);
		const id = prefix + candidate.id;
		return engage.getWorker(id).then(([status, response]) => {
			if (status === 404)
				return convertAndCreateWorker(integrationConfig, candidate, callback);
			else if (status === 200) {
				log.info(`Worker already exists for id ${ id }`);
				callback();
				return Promise.resolve(response);
			}
			else {
				log.warn(`Unexpected status code when fetching worker: ${ status }`);
				return Promise.reject(response);
			}
		}).catch((error) => {
			log.warn(`Cannot fetch worker by id ${ id }. ${ error }`);
			return Promise.reject(error);
		});
	}
	return Promise.reject("No data to process");
}

function getOrCreateWorker(integrationConfig, candidateId, callback) {
	const bullhorn = Bullhorn.createOrGet(integrationConfig.bullhorn);
	const engage = new Engage(integrationConfig);
	const prefix = integrationConfig.bullhorn.workerPrefix;
	const id = prefix + candidateId;

	return engage.getWorker(id).then(([status, response]) => {
		if (status === 200) {
			log.info(`Worker ${ id } already exists Engage platform`);
			callback();
			return Promise.resolve(response);
		}
		else if (status === 404) {
			return bullhorn.getEntity("Candidate", candidateId, integrationConfig.bullhorn.candidateFields).then(([, candidate]) => {
				log.info(`Fetched candidate for updated placement with candidate id ${ candidateId }`);
				return processUpdate(integrationConfig, candidate, callback);
			}).catch((error) => {
				return Promise.reject(error);
			});
		}
		else {
			log.info(`An error occurred (HTTP ${ status }) while fetching worker ${ id }`);
			return Promise.reject(response.message);
		}
	});
}


module.exports = {
	configure: (integrationConfig) => {
		log = integrationConfig.getLogUtils().log;
	},
	getOrCreateWorker: getOrCreateWorker 
};
