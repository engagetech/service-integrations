#!/bin/bash

set -eu

# Environment for these images is always preprod, but containers are expected to work in any environment.
ECR="531568711534.dkr.ecr.eu-west-1.amazonaws.com"

if [[ "$SERVICE_BUILD" == "master" ]] ; then
    TAG="$(cat package.json | jq -r '.version')"
else
    TAG="$SERVICE_BUILD"
fi

echo "--- Logging in to ECR"
eval $(aws ecr get-login --no-include-email)

echo "+++ Running docker"
docker build \
    -t $SERVICE:$TAG \
    -f .buildkite/scripts/Dockerfile \
    --build-arg SERVICE=$SERVICE \
    .

echo "--- Pushing to ECR repository"
docker tag $SERVICE:$TAG $ECR/$SERVICE:$TAG
docker push $ECR/$SERVICE:$TAG

# If master then also push the `latest` tag
if [[ "$SERVICE_BUILD" == "master" ]] ; then
    docker tag $SERVICE:$TAG $ECR/$SERVICE:latest
    docker push $ECR/$SERVICE:latest
fi

docker logout $ECR

# Ignore failures from now on
set +e

echo "--- Cleaning up images"
# Remove all dangling images
docker image prune -f || true
# Remove all unused images with an 'engage.service' label
docker image prune -af --filter "label=engage.service" || true

echo "--- Cleaning up ECR repository"
aws ecr list-images --repository-name $SERVICE |
    jq -r '.imageIds[] | select(.imageTag == null) | .imageDigest' |
    xargs -I {} sh -c "aws ecr batch-delete-image --repository-name $SERVICE --image-ids imageDigest={} || true"
