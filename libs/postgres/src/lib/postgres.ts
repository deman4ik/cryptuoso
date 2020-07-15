import { createPool, sql } from "slonik";
import { createFieldNameTransformationInterceptor } from "slonik-interceptor-field-name-transformation";
import { prepareUnnest } from "./helpers";

const interceptors = [
    createFieldNameTransformationInterceptor({
        format: "CAMEL_CASE"
    })
];

const pg = createPool(process.env.PGCS, {
    interceptors
});

const pgUtil = {
    prepareUnnest
};

export { pg, sql, pgUtil };
