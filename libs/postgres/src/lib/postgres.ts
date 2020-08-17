import { createPool, sql } from "slonik";
import { createFieldNameTransformationInterceptor } from "slonik-interceptor-field-name-transformation";
import { prepareUnnest } from "./helpers";

const interceptors = [
    createFieldNameTransformationInterceptor({
        format: "CAMEL_CASE"
    })
];

const pg = createPool(process.env.PGCS, {
    maximumPoolSize: 60,
    connectionTimeout: 60e3,
    statementTimeout: 60e3,
    preferNativeBindings: false,
    interceptors
});

const pgUtil = {
    prepareUnnest
};

export { pg, sql, pgUtil };
