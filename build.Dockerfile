FROM node:14-alpine as build

RUN apk add --no-cache python postgresql-dev build-base git openssh-client

ARG GITHUB_SSH_KEY
RUN \
    mkdir ~/.ssh/ && \
    echo "$GITHUB_SSH_KEY" > ~/.ssh/id_rsa && \
    chmod 600 ~/.ssh/id_rsa && \
    eval $(ssh-agent) && \
    echo -e "StrictHostKeyChecking no" >> /etc/ssh/ssh_config && \
    ssh-add ~/.ssh/id_rsa && \
    touch ~/.ssh/known_hosts && \
    ssh-keyscan github.com >> ~/.ssh/known_hosts

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

COPY . /usr/src/app/

RUN npm install