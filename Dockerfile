FROM node:14-alpine as build

RUN apk add --no-cache python postgresql-dev build-base git openssh-client

ARG GITHUB_SSH_KEY
ARG SERVICE_NAME
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

RUN npm install && npm run build:"$SERVICE_NAME" && npm prune --production

FROM node:14-alpine as runtime
RUN mkdir -p /usr/src/app
COPY --from=build ["/usr/src/app/node_modules","/usr/src/app/node_modules"]
COPY --from=build ["/usr/src/app/dist","/usr/src/app/dist"]
ARG SERVICE_NAME
ENV PORT=3000
ENV LS_PORT=9000
ENV NODE_ENV="production"
EXPOSE 3000 9000
WORKDIR /usr/src/app/dist/apps/${SERVICE_NAME}
CMD ["node", "main.js"]