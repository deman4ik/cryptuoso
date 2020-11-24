import { Logger, ISettingsParam } from "tslog";

const loggerConfig: ISettingsParam =
    process.env.NODE_ENV === "production"
        ? {
              name: process.env.SERVICE,
              type: "json",
              exposeErrorCodeFrame: false,
              ignoreStackLevels: 1,
              displayRequestId: false,
              displayFilePath: "hidden",
              minLevel: "info",
              maskValuesOfKeys: ["authorization", "password", "refreshToken", "accessToken"]
          }
        : {
              name: process.env.SERVICE,
              minLevel: "debug",
              printLogMessageInNewLine: false,
              displayFilePath: "hidden",
              displayFunctionName: false,
              exposeErrorCodeFrame: true
          };

const logger = new Logger(loggerConfig);

export { logger, Logger };
