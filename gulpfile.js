/******************************************************************************************

Automated building of JavaScript and LESS files courtesy of Gulp

******************************************************************************************/

var package = require("./package.json");
var path = require("path");
var fs = require("fs");
var util = require("util");
var gulp = require("gulp");
var gulpsync = require("gulp-sync")(gulp);
var rename = require("gulp-rename");
var git = require("gulp-git");
var replace = require("gulp-replace");
var gutil = require("gulp-util");


// Git commit hash and branch for this build
var githash = "";
var gitbranch = "";

// Script building utility function
function buildPathArray(prefix, paths) {
	var list = [];
	prefix = prefix || "";

	for (var u = 0; u < paths.length; u++)
		list.push(prefix + paths[u]);

	return list;
};

// Get the latest commit hash
gulp.task("gitinfo", function(done) {
	git.revParse({ args: "--short HEAD" }, function(error, output) {
		if (error)
			stream.emit("error", new gutil.PluginError("gulp-git", error));
		else
			githash = output;

		// Because Buildkite checks out a commit, git revparse will always return HEAD
		if (process.env.BUILDKITE_BRANCH) {
			gitbranch = process.env.BUILDKITE_BRANCH;
			done();

			return;
		}

		git.revParse({ args: "--abbrev-ref HEAD" }, function(error, output) {
			if (error)
				stream.emit("error", new gutil.PluginError("gulp-git", error));
			else
				gitbranch = output;

			done();
		});
	});
});

// Copy built files to release directory
gulp.task("create-config", ["gitinfo"], function() {
	try {
		fs.unlinkSync("./config.js");
	}
	catch (error) {
	}

	return gulp.src("config.js.example")
		.pipe(replace(/{{git-commit}}/ig, githash))
		.pipe(replace(/{{git-branch}}/ig, gitbranch))
		.pipe(rename("config.js"))
		.pipe(gulp.dest("./"));
});

// Main release build chain
gulp.task("build", gulpsync.sync(["create-config"], "sync release"));

// Present help info
gulp.task("help", function() {
	console.log("options:");
	console.log("build\n  : standard build");
});

// Default build task
gulp.task("default", ["build"]);
