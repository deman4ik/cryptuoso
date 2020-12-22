import { createPool, sql, ClientConfigurationInputType, createTypeParserPreset } from "slonik";
import { createFieldNameTransformationInterceptor } from "slonik-interceptor-field-name-transformation";
import dayjs from "@cryptuoso/dayjs";
import { prepareUnnest } from "./helpers";

const interceptors = [
    createFieldNameTransformationInterceptor({
        format: "CAMEL_CASE"
    })
];
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
    connectionRetryLimit: 10,
    connectionTimeout: "DISABLE_TIMEOUT",
    idleTimeout: 3000,
    maximumPoolSize: 10,
    interceptors,
    typeParsers
};

const pg = createPool(process.env.PGCS, config);

const createJSPool = (pgConfig: ClientConfigurationInputType = {}) =>
    createPool(process.env.PGCS, { ...config, preferNativeBindings: false, ...pgConfig });

const pgUtil = {
    createJSPool,
    prepareUnnest
};

export { pg, sql, pgUtil };
