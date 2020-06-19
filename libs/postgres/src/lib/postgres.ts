import postgres from "postgres";
import logger from "@cryptuoso/logger";
//TODO: delete custom declaration type

const sql = postgres({
    ssl: { rejectUnauthorized: false },
    //onnotice: logger.info,
    //  debug: logger.debug,
    transform: {
        column: postgres.toCamel
    },
    connection: {
        application_name: process.env.SERVICE
    }
});

export { sql };
