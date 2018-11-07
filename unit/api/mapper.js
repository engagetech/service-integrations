const assert = require("assert");

const { candidateToWorker, workerToCandidate } = require("../../api/mapper");

const exampleConfig = {
	"mappings": {
		"candidateToWorker": {
			"address.zip": "AddressPostCode",
			"firstName": "FirstName",
			"lastName": "Surname",
			"address.city": "Address3",
			"address.address2": "Address2",
			"mobile": "Mobile",
			"address.address1": "Address1",
			"id": "EmployeeId",
			"email": "Email"
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
	"EmployeeId": "BH-1",
	"FirstName": "John",
	"Surname": "Smith",
	"Email": "john@example.com",
	"Mobile": "7111111111",
	"Address1": "10 Strokes St",
	"Address2": "Voidz",
	"Address3": "London",
	"AddressPostCode": "A1 1AA"
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
