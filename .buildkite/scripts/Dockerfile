FROM node:8
ARG SERVICE
LABEL engage.service=${SERVICE}

COPY .buildkite/scripts/run.sh /opt/services/${SERVICE}/run.sh

RUN mkdir /app && \
    chmod +x /opt/services/${SERVICE}/run.sh

WORKDIR /app
ENV PATH /app/node_modules/.bin:$PATH

ADD . /app

RUN npm install && \
    npm run build
