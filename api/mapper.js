"use strict";

const _ = require("lodash");

/******************************
 * Mapping utilities for data between bullhorn and engage
 ******************************/

function _mapNested(mapping, seed, prefix, data) {
	return _.reduce(data, (result, value, key) => {
		const mappedKey = mapping[prefix + "." + key];
		if (mappedKey) 
			_.set(result, mappedKey, value);
		
		return result;
	}, seed);
}

function _mapWithMapping(mapping, data) {
	return _.reduce(data, (result, value, key) => {
		if (_.isObject(value))
			return _mapNested(mapping, result, key, value);
		else {
			const mappedKey = mapping[key];
			if (mappedKey) 
				_.set(result, mappedKey, value);
			
			return result;
		}
	}, {});
}

function candidateToWorker(bhConfig, data) {
	const idPrefix = bhConfig.workerPrefix;
	const mapping = bhConfig.mappings.candidateToWorker;
	const mapped = _mapWithMapping(mapping, data);
	mapped[mapping["id"]] = idPrefix + data.id;
	return mapped;
}

function workerToCandidate(bhConfig, data) {
	const idPrefix = bhConfig.workerPrefix;
	const mapping = _.invert(bhConfig.mappings.candidateToWorker);
	const mapped = _mapWithMapping(mapping, data);
	mapped["id"] = mapped["id"].replace(idPrefix, "");
	return mapped;
}

module.exports = {
	candidateToWorker: candidateToWorker,
	workerToCandidate: workerToCandidate
};
