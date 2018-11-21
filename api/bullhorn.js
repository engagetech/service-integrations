"use strict";

const url = require("url");
const Promise = require("bluebird");
const request = Promise.promisifyAll(require("request"), { multiArgs: true });

/* --------------------------------------------------------
 * Bullhorn API abstraction
 * Documentation: http://bullhorn.github.io/rest-api-docs/
 * -------------------------------------------------------- */

const cache = {};

class Bullhorn {
	constructor(config) {
		this.config = config;
		this.bhLoginData = {};
	}

	// Keep a mapping of clientId <-> api instance, so we don't have to initiate
	// auth every time
	static createOrGet(config) {
		if (!cache[config.clientId]) 
			cache[config.clientId] = new Bullhorn(config);
		
		return cache[config.clientId];
	}

	// ---- Auth Utils ----

	_getAuthCode({ apiUrl, clientId, redirectUri, username, password }) {
		const options = {
			url: `${ apiUrl }/oauth/authorize?client_id=${ clientId }&response_type=code&redirect_uri=${ redirectUri }&username=${ username }&password=${ password }&action=Login`,
			json: true,
			followRedirect: false
		};

		return request.getAsync(options)
			.then(([response]) => {
				const redirect = url.parse(response.headers.location, true);
				return redirect.query.code;
			});
	}

	_getTokens({ apiUrl, clientId, redirectUri, clientSecret, code }) {
		const options = {
			url: `${ apiUrl }/oauth/token?client_id=${ clientId }&client_secret=${ clientSecret }&redirect_uri=${ redirectUri }&code=${ code }&grant_type=authorization_code`,
			json: true
		};

		return request.postAsync(options)
			.then(([, body]) => {
				return body;
			});
	}

	_refreshTokens({ clientId, clientSecret, refresh_token }) {
		const options = {
			url: `https://rest.bullhornstaffing.com/oauth/token?grant_type=refresh_token&refresh_token=${ refresh_token }&client_id=${ clientId }&client_secret=${ clientSecret }`,
			json: true

		};

		return request.postAsync(options)
			.then(([, body]) => {
				return body;
			});
	}

	_login(accessToken) {
		const options = {
			url: `https://rest.bullhornstaffing.com/rest-services/login?access_token=${ accessToken }&version=*`,
			json: true
		};

		return request.getAsync(options)
			.then(([, body]) => {
				return body;
			});
	}

	_getLoginData() {
		return this._getAuthCode(this.config).then((code) => {
			const cfg = Object.assign(this.config, { code: code });
			return this._getTokens(cfg).then((tokens) => {
				return this._login(tokens.access_token);
			});
		});
	}

	_ensureCacheInitialized() {
		if (this.bhLoginData.restUrl) 
			return Promise.resolve(this.bhLoginData);
		else
			return this._getLoginData();
	}

	_withRetryingAuth(f) {
		return (... args) => {
			return this._ensureCacheInitialized().then((bhLoginData) => {
				this.bhLoginData = bhLoginData;
				return f.apply(null, [this.bhLoginData, ... args]);
			}).then(([status, response]) => {
				if (status === 401) {
					return this._getLoginData().then((loginData) => {
						this.bhLoginData = loginData;
						return f.apply(null, [this.bhLoginData, ... args]);
					});
				}
				return [status, response];
			});
		};
	}

	// ---- Entity operations

	_getEntity({ BhRestToken, restUrl }, entity, id, fields) {
		const fieldsParam = fields.join(",");
		const options = {
			url: `${ restUrl }entity/${ entity }/${ id }?fields=${ fieldsParam }`,
			headers: { BhRestToken: BhRestToken },
			json: true
		};

		return request.getAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	/**
	 * See http://bullhorn.github.io/rest-api-docs/#get-entity
	 * @param {String} entity The entity to query
	 * @param {Number} id, The entity id
	 * @param {Array} fields A string array for the fields to return
	 * @returns {Array} A tuple of status code and an object in the following format
	 * {
     *   "data": {
     *     "id": 55,
     *     "firstName": "John"
     *   }
     * }
	 */
	getEntity(entity, id, fields) {
		return this._withRetryingAuth(this._getEntity)(entity, id, fields);
	}

	_createEntity({ BhRestToken, restUrl }, entity, body) {
		const options = {
			url: `${ restUrl }entity/${ entity }`,
			headers: { BhRestToken: BhRestToken },
			json: true,
			body: body
		};

		return request.putAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	/**
	 * See http://bullhorn.github.io/rest-api-docs/#put-entity
	 * @param {String} entity The entity to create 
	 * @param {Object} data The creation payload
	 * @returns {Object} A tuple of status code and an object in the following format
	 * {
		"changedEntityType": "JobOrder",
		"changedEntityId": 46,
		"changeType": "INSERT",
		"data": { ... }
		}
	 */
	createEntity(entity, data) {
		return this._withRetryingAuth(this._createEntity)(entity, data);
	}

	_updateEntity({ BhRestToken, restUrl }, entity, id, body) {
		const options = {
			url: `${ restUrl }entity/${ entity }/${ id }`,
			headers: { BhRestToken: BhRestToken },
			json: true,
			body: body
		};

		return request.postAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	/**
	 * See http://bullhorn.github.io/rest-api-docs/#post-entity
	 * @param {String} entity The entity type
	 * @param {Number} id The id of the entity to update
	 * @param {Object} data A map of fields to update
	 * @returns {Array} A tuple of status code and an object with update information
	 */
	updateEntity(entity, id, data) {
		return this._withRetryingAuth(this._updateEntity)(entity, id, data);
	}

	// ------ Search ----

	_searchEntity({ BhRestToken, restUrl }, entity, fields, query) {
		const fieldsParam = fields.join(",");
		const options = {
			url: `${ restUrl }search/${ entity }?fields=${ fieldsParam }&query=${ query }`,
			headers: { BhRestToken: BhRestToken },
			json: true
		};

		return request.getAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	/**
	 * See http://bullhorn.github.io/rest-api-docs/#search
	 * @param {String} entity The entity type 
	 * @param {Array} fields A string array of the fields to return
	 * @param {String} query The query
	 * @returns {Array} A tuple of status code and an array of the matching entities,
	 * having the queried fields
	 */
	searchEntity(entity, fields, query) {
		return this._withRetryingAuth(this._searchEntity)(entity, fields, query);
	}


	// ---------- Query ----------------

	_queryEntity({ BhRestToken, restUrl }, entity, fields, where) {
		const fieldsParam = fields.join(",");
		const options = {
			url: `${ restUrl }query/${ entity }?fields=${ fieldsParam }&where=${ where }`,
			headers: { BhRestToken: BhRestToken },
			json: true
		};

		return request.getAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	/**
	 * See http://bullhorn.github.io/rest-api-docs/#query
	 * @param {String} entity The entity type 
	 * @param {Array} fields A string array of the fields to return
	 * @param {String} where where clause
	 * @returns {Array} A tuple of status code and an array of the matching entities,
	 * having the queried fields
	 */
	queryEntity(entity, fields, where) {
		return this._withRetryingAuth(this._queryEntity)(entity, fields, where);
	}

	// ---- Subscriptions -----

	_createSubscription({ BhRestToken, restUrl }, subscription, type, names, eventTypes) {
		const events = eventTypes.join(",");
		const options = {
			url: `${ restUrl }event/subscription/${ subscription }?type=${ type }&names=${ names }&eventTypes=${ events }`,
			headers: { BhRestToken: BhRestToken },
			json: true
		};

		return request.putAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	_getSubscriptionData({ BhRestToken, restUrl }, subscription, maxEvents = 100) {
		const options = {
			url: `${ restUrl }event/subscription/${ subscription }?maxEvents=${ maxEvents }`,
			headers: { BhRestToken: BhRestToken },
			json: true
		};

		return request.getAsync(options)
			.then(([res, body]) => {
				const data = body || { events: [] }; // an empty body is returned if there are not events
				return [res.statusCode, data];
			});
	}

	/**
	 * Getting all events will remove the elements from bullhorn. This is the reason why
	 * persisting the events is recommended before actually processing the data.
	 * 
	 * See http://bullhorn.github.io/rest-api-docs/#events
	 * 
	 * @param {String} subscription The name of the subscription
	 * @param {Number} maxEvents The maximum number of events to get
	 * @returns {Array} An array of events:
	 * {
			"requestId": 57,
			"events": [
				{
					"eventId": "ID:JBM-00000000",
					"eventType": "ENTITY",
					"eventTimestamp": 1541145049090,
					"eventMetadata": {
						"TRANSACTION_ID": "d0b9af23-00cf-4673-8e4b-xxxxxxxxxxx",
						"CHANGE_HISTORY_ID": "280",
						"PERSON_ID": "2"
					},
					"entityName": "Candidate",
					"entityId": 74,
					"entityEventType": "UPDATED",
					"updatedProperties": [
						"middleName"
					]
				}
			]
		}
	 */
	getSubscriptionData(subscription, maxEvents) {
		return this._withRetryingAuth(this._getSubscriptionData)(subscription, maxEvents);
	}

}

module.exports = {
	Bullhorn: Bullhorn
};
