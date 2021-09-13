FROM cryptuoso-build:latest as build

ARG SERVICE_NAME

RUN npm run build:"$SERVICE_NAME" && npm prune --production && npm cache clean --force

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