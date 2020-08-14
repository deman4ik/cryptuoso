import { createPool, sql, ClientConfigurationInputType } from "slonik";
import { createFieldNameTransformationInterceptor } from "slonik-interceptor-field-name-transformation";
import { prepareUnnest } from "./helpers";

const interceptors = [
    createFieldNameTransformationInterceptor({
        format: "CAMEL_CASE"
    })
];

const config: ClientConfigurationInputType = {
    connectionRetryLimit: 5,
    connectionTimeout: 10000,
    idleTimeout: 3000,
    maximumPoolSize: 16,
    interceptors
};

const pg = createPool(process.env.PGCS, config);

const createJSPool = (pgConfig: ClientConfigurationInputType = {}) =>
    createPool(process.env.PGCS, { ...config, preferNativeBindings: false, ...pgConfig });

const pgUtil = {
    createJSPool,
    prepareUnnest
};

export { pg, sql, pgUtil };
