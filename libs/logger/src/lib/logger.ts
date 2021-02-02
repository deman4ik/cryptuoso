/* import { Logger, ISettingsParam } from "tslog";

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
 */

import { Logger, format, createLogger, LoggerOptions, transports } from "winston";
import { TransformableInfo } from "logform";
import { MESSAGE, LEVEL, SPLAT } from "triple-beam";
import { inspect } from "util";

/* UGLY TS OBJECT KEY TYPE FIX */
const MESSAGESYMBOL = (MESSAGE as unknown) as string;
const LEVELSYMBOL = (LEVEL as unknown) as string;
const SPLATSYMBOL = (SPLAT as unknown) as string;

/* Helper functions for pretty console logging for development */
const prettyStringify = (obj: { [key: string]: any }) => inspect({ ...obj }, false, 20, true);

const stringifyFirstArg = format((info) => {
    if (typeof info.message === "object") {
        info[MESSAGESYMBOL] = `\n${prettyStringify(info.message)}`;
    }
    return info;
});

const debugFormat = format((info: TransformableInfo) => {
    const rest = Object.assign({}, info, {
        level: undefined,
        message: undefined,
        splat: undefined,
        label: undefined,
        timestamp: undefined
    });
    delete rest[LEVELSYMBOL];
    delete rest[MESSAGESYMBOL];
    delete rest[SPLATSYMBOL];
    delete rest.level;
    delete rest.message;
    delete rest.splat;
    delete rest.label;
    delete rest.timestamp;

    const stringifiedRest = prettyStringify(rest);

    const padding = (info.padding && info.padding[info.level]) || "";

    if (stringifiedRest !== "{}") {
        info[
            MESSAGESYMBOL
        ] = `${info.timestamp} ${info.level} [${info.label}]${padding} ${info.message} \n${stringifiedRest}`;
    } else {
        info[MESSAGESYMBOL] = `${info.timestamp} ${info.level} [${info.label}]${padding} ${info.message}`;
    }

    return info;
});

const loggerConfig: LoggerOptions =
    process.env.NODE_ENV === "production"
        ? {
              format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
              level: process.env.LOG_LEVEL || "debug",
              transports: [new transports.Console()]
          }
        : {
              format: format.combine(
                  format.label({ label: process.env.SERVICE }),
                  format.timestamp({
                      format: "YYYY-MM-DD HH:mm:ss.SSS"
                  }),
                  format.errors({ stack: true }),
                  stringifyFirstArg(),
                  format.colorize({ all: true }),
                  debugFormat()
              ),
              level: process.env.LOG_LEVEL || "debug",
              transports: [new transports.Console()]
          };

const logger = createLogger(loggerConfig);

export { logger, Logger };
