import {
    createPool,
    sql,
    ClientConfigurationInput,
    createTypeParserPreset,
    DatabasePool,
    DatabaseTransactionConnection
} from "slonik";
import { createFieldNameTransformationInterceptor } from "slonik-interceptor-field-name-transformation";
import { createQueryLoggingInterceptor } from "slonik-interceptor-query-logging";
import dayjs from "@cryptuoso/dayjs";
import { prepareUnnest } from "./helpers";

const interceptors = [
    createFieldNameTransformationInterceptor({
        format: "CAMEL_CASE"
    })
];

if (process.env.ROARR_LOG) {
    interceptors.push(createQueryLoggingInterceptor());
}

const parseDate = (value: string) => (!value ? value : dayjs.utc(value + "+0000").toISOString());

const typeParsers = [
    ...createTypeParserPreset(),
    {
        name: "date",
        parse: parseDate
    },
    {
        name: "timestamp",
        parse: parseDate
    },
    {
        name: "timestamptz",
        parse: parseDate
    }
];

const config: ClientConfigurationInput = {
    connectionRetryLimit: 1000,
    connectionTimeout: 30000,
    statementTimeout: "DISABLE_TIMEOUT",
    idleInTransactionSessionTimeout: "DISABLE_TIMEOUT",
    interceptors,
    typeParsers,
    ssl: {
        rejectUnauthorized: false
    }
};

const pg = createPool(process.env.PGCS, config);

const pgUtil = {
    prepareUnnest
};

export { pg, sql, pgUtil, DatabasePool, DatabaseTransactionConnection };
