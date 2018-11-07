"use strict";

/******************************************************************************************

Triggers cron jobs that poll endpoints

******************************************************************************************/

const bullhorn = require("./bullhorn.js");

module.exports = {
	register: (integrationConfig) => {
		bullhorn.addPollers(integrationConfig);
	}
};
