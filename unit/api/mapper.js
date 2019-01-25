const assert = require("assert");

const { candidateToWorker, workerToCandidate } = require("../../api/mapper");

const exampleConfig = {
	"mappings": {
		"candidateToWorker": {
			"address.zip": "addressPostCode",
			"firstName": "firstName",
			"lastName": "lastName",
			"address.city": "address3",
			"address.address2": "address2",
			"mobile": "mobile",
			"address.address1": "address1",
			"id": "employeeId",
			"email": "email"
		}
	},
	"workerPrefix": "BH-"
};

const candidate = {
	"id": 1,
	"firstName": "John",
	"lastName": "Smith",
	"email": "john@example.com",
	"mobile": "7111111111",
	"address": {
		"address1": "10 Strokes St",
		"address2": "Voidz",
		"city": "London",
		"zip": "A1 1AA"
	}
};

const worker = {
	"employeeId": "BH-1",
	"firstName": "John",
	"lastName": "Smith",
	"email": "john@example.com",
	"mobile": "7111111111",
	"address1": "10 Strokes St",
	"address2": "Voidz",
	"address3": "London",
	"addressPostCode": "A1 1AA"
};


describe("Candidate/Worker convertion", () => {
	it("should convert candidate to worker", () => {
		const converted = candidateToWorker(exampleConfig, candidate);
		assert.deepEqual(worker, converted);
	});

	it("should convert worker to candidate", () => {
		const converted = workerToCandidate(exampleConfig, worker);
		assert.deepEqual(candidate, converted);
	});
});
