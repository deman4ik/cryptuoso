import { Logger, ISettingsParam } from "tslog";

const loggerConfig: ISettingsParam =
    process.env.NODE_ENV === "production"
        ? {
              name: process.env.SERVICE,
              type: "json",
              exposeErrorCodeFrame: false
          }
        : {
              name: process.env.SERVICE
          };

const logger = new Logger(loggerConfig);

export { logger, Logger };
