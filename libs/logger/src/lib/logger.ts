import { Logger, ISettingsParam } from "tslog";

const loggerConfig: ISettingsParam =
    process.env.NODE_ENV === "production"
        ? {
              name: process.env.SERVICE,
              type: "json",
              exposeErrorCodeFrame: false,
              minLevel: "info"
          }
        : {
              name: process.env.SERVICE,
              minLevel: "debug",
              printLogMessageInNewLine: false,
              displayFilePath: "hidden",
              displayFunctionName: false
          };

const logger = new Logger(loggerConfig);

export { logger, Logger };
