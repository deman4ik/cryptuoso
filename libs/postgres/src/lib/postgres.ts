import postgres from "postgres";
//TODO: delete custom declaration type

const sql = postgres({
    ssl: { rejectUnauthorized: false },
    transform: {
        column: postgres.toCamel
    },
    connection: {
        /* eslint-disable-next-line @typescript-eslint/camelcase */
        application_name: process.env.SERVICE
    }
});

export { sql };
