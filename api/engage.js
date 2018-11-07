"use strict";

const Promise = require("bluebird");
const request = Promise.promisifyAll(require("request"), { multiArgs: true });

class Engage {
	constructor({ engageExternalApi, engageApiKey }) {
		this.engageExternalApi = engageExternalApi;
		this.engageApiKey = engageApiKey;
	}

	_getAuthHeader() {
		return {
			"x-api-key": this.engageApiKey
		};
	}

	createWorker(data) {
		const options = {
			url: `${ this.engageExternalApi }/workers`,
			headers: this._getAuthHeader(),
			json: true,
			body: data
		};

		return request.postAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});

	}

	getWorker(id) {
		const options = {
			url: `${ this.engageExternalApi }/workers/${ id }`,
			headers: this._getAuthHeader(),
			json: true
		};

		return request.getAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	triggerAction(id, data) {
		const options = {
			url: `${ this.engageExternalApi }/workers/${ id }/actions`,
			headers: this._getAuthHeader(),
			json: true,
			body: data
		};

		return request.postAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}
}

module.exports = {
	Engage: Engage
};
