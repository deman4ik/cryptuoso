import postgres from "postgres";
//TODO: delete custom declaration type
/* eslint-disable @typescript-eslint/camelcase */
const sql = postgres({
    ssl: { rejectUnauthorized: false },
    connect_timeout: 10,
    transform: {
        column: postgres.toCamel
    },
    connection: {
        application_name: process.env.SERVICE
    }
});

export { sql };
