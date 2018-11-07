#!/bin/bash

set -e

CONFIG_FILE="/app/config.js"

if [ -z "$CONFIG_FILE" ] && [ ! -f $CONFIG_FILE ]; then
	echo "Configuration file not found!"
	exit 1
fi

# Start the application.
node /app/server.js $CONFIG_FILE
