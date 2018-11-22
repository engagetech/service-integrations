#!/usr/bin/env node

var _ = require("lodash");

// Read in service configuration
global.config = require("./config.js")
var config = global.config;

// Look for server specific config overrides
var args = process.argv.slice(2);
var serverConfigLocation = "../server-config.js";

if (args.length > 0) {
	serverConfigLocation = args[0];
}

try {
	console.log("Attempting to load configuration from " + serverConfigLocation);
	var serverConfig = require(serverConfigLocation);
	_.merge(config, serverConfig);
}
catch (error) {
	console.log("Running in a dev environment...");
}

var package = require("./package.json");
var restify = require("restify");
var webhooks = require("./webhooks/main.js");
var pollers = require("./pollers/main.js");
var os = require("os");
var bunyan = require('bunyan');


// Create logger instance
var log = bunyan.createLogger({
	name: "integrations",
	streams: [
		{
			stream: process.stdout,
			level: "info"
		},
		{
			stream: process.stderr,
			level: "error"
		}
	]
});

// Create a restify server instance
var server = restify.createServer({
	name: package.name,
	version: package.version,
	log: log,
	handleUncaughtExceptions: false
});

// Configure the instance
server.use(restify.plugins.acceptParser(server.acceptable));
server.pre(restify.pre.sanitizePath());
server.use(restify.plugins.queryParser({
	mapParams: true
}));
server.use(restify.plugins.bodyParser({
	maxBodySize: config.maxFileSize,
	mapParams: true,
	mapFiles: false,
	overrideParams: false,
	keepExtensions: true,
	uploadDir: os.tmpdir(),
	multiples: true
}));

// Log requests (body can be logged by adding the `body: true` property)
var auditLogger = restify.plugins.auditLogger({
	log: log,
	event: "pre",
	body: true
});

server.on("after", function (req, res, route, err) {
	// Don't want to log healthchecks as they spam the logs
	if (route && (route.spec.path == "healthcheck"))
		return;

	auditLogger(req, res, route, err);
});

// Support error logger
function makeLogObject(request, response, error) {
	var latency = response.get ? response.get("Response-Time") : null;

	if (typeof (latency) !== "number")
		latency = Date.now() - request._time;

	var obj = {
		remoteAddress: request.connection.remoteAddress,
		remotePort: request.connection.remotePort,
		req: {
			query: request.query,
			//body: JSON.stringify(request.body), // May be privacy issues logging body content
			method: request.method,
			url: request.url,
			headers: request.headers
		},
		latency: latency,
		secure: request.secure,
		err: {
			stack: error.stack
		}
	};

	return obj;
}

// Log errors
server.on("uncaughtException", (request, response, route, error) => {
	request.log.error(makeLogObject(request, response, error));

	response.status(500);
	response.send({ error: true, message: "The server did something unexpected, as you read this elves are panicking to work out what happened and fix it!" });
	response.end();
});

var serverIP = process.env.server_ip || config.ip;
var serverPort = process.env.server_port || config.port;

console.log(`
╦┌┐┌┌┬┐┌─┐┌─┐┬─┐┌─┐┌┬┐┬┌─┐┌┐┌┌─┐
║│││ │ ├┤ │ ┬├┬┘├─┤ │ ││ ││││└─┐
╩┘└┘ ┴ └─┘└─┘┴└─┴ ┴ ┴ ┴└─┘┘└┘└─┘
`);

console.log(`${ package.name } v${ package.version }`);
console.log(`Build branch: ${ config.gitBranch }, commit: ${ config.gitCommit }`);
console.log(`Node version: ${ process.version }`);
console.log(`\nListening on ${ serverIP } port ${ serverPort }`);

// Start the actual server
server.listen(serverPort, serverIP);

// Helper functions for features
var integrationConfig = {
	get: (route, func) => {
		server.get([config.apiRoot, route].join("/"), func);
	},
	post: (route, func) => {
		server.post([config.apiRoot, route].join("/"), func);
	},
	put: (route, func) => {
		server.put([config.apiRoot, route].join("/"), func);
	},
	delete: (route, func) => {
		server.del([config.apiRoot, route].join("/"), func);
	},
	getLogUtils: () => {
		return {
			makeLogObject: makeLogObject,
			log: log
		};
	}
};

// Add a default version route
server.get([config.apiRoot, "version"].join("/"), (request, response, next) => {
	response.status(200);
	response.send({
		name: package.name,
		version: package.version,
		commit: config.gitCommit,
		branch: config.gitBranch
	});
	next();
});

// Add features we will be offering
webhooks.register(integrationConfig);
pollers.register(integrationConfig);

// Add the most basic of healthchecks
server.get("healthcheck", (request, response, next) => {
	response.send({
		status: "Okay",
		name: package.name,
		version: package.version
	});
	next();
});

// List all routes registered
console.log("\nRegistered routes:");
for (key in server.router.mounts) {
	console.log(server.router.mounts[key].method, server.router.mounts[key].spec.path);
}

// Log exit
function exitHandler(options, err) {
	if (options.cleanup)
		console.log(package.name, "shutting down");
	if (err)
		console.log(err.stack);
	if (options.exit)
		process.exit();
}

// Handle standard app close
process.on("exit", () => {
	console.log(package.name, "shutting down");
});

// Handle graceful request to exit
process.on("SIGTERM", () => {
	console.log("\nInterrupting service");
	process.exit();
});

// Uncaught exceptions
process.on("uncaughtException", (options, error) => {
	console.log("options: ",options);
	console.log("error: ",error);
	var logObj = {
		err: {
			stack: (error && error.stack) ? error.stack : "Stack unavailable :(",
			error: options
		}
	};

	log.error(logObj);
});

console.log("\nListening...");
