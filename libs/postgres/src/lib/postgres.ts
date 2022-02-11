import {
    createPool,
    sql,
    ClientConfigurationInputType,
    createTypeParserPreset,
    DatabasePoolType,
    DatabaseTransactionConnectionType
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

const config: ClientConfigurationInputType = {
    connectionRetryLimit: 1000,
    connectionTimeout: 60000,
    idleTimeout: 3000,
    maximumPoolSize: 10,
    interceptors,
    typeParsers
};

const pg = createPool(process.env.PGCS, config);

const pgUtil = {
    prepareUnnest
};

export { pg, sql, pgUtil, DatabasePoolType, DatabaseTransactionConnectionType };
