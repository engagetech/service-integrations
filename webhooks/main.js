"use strict";

/******************************************************************************************

Include all the routes that the service will listen to

******************************************************************************************/

const _ = require("lodash");

const workers = require("./workers.js");
const datastore = require("../datastore/main").createOrGet();

var log = null;

const actionFuncs = {
	"workerupdate": workers.workerUpdated
};

function webhookDispatcher(request, response, next) {
	response.status(200);
	response.send({});

	log.info("Webhook triggered", request.body);

	const token = request.params.token;
	if (token) {
		datastore.getAllIntegrations().then((integrations) => {
			const integration = _.find(integrations, (int) => int.webhookToken === token);
			if (integration) {
				const data = request.body;
				const action = `${ data.type }${ data.action }`.toLowerCase();

				if (actionFuncs[action])
					actionFuncs[action](integration, data);
				else 
					log.warn("No action handler for the requested action");

			}
			else
				log.warn("No integration present for the provided webhook token");
		});
	}
	else
		log.warn("Webhook token is missing");

	if (next)
		next();
}

module.exports = {
	register: (integrationConfig) => {
		log = integrationConfig.getLogUtils().log;
		workers.configure(integrationConfig);
		integrationConfig.post("webhook/:token", webhookDispatcher);
	}
};
