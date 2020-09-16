process.env.REFRESH_TOKEN_EXPIRES = "1";
process.env.JWT_SECRET = "secret";
process.env.JWT_TOKEN_EXPIRES = "1";
process.env.BOT_TOKEN = "BOT_TOKEN";

import Service from "../app/service";
import { makeServiceRequest } from "@cryptuoso/test-helpers";
import Cookie from "cookie";
import { User } from "@cryptuoso/user-state";
import dayjs from "dayjs";

jest.setTimeout(15000);

describe("AuthService e2e test", () => {
    const port = 5555;
    const service = new Service({ port });

    beforeAll(async (done) => {
        await service.startService();

        done();
    });

    describe("Refresh token route", () => {
        test("Should update DB users.last_active_at", async () => {
            const user: User = await service.db.pg.maybeOne(service.db.sql`
                SELECT * FROM users
                WHERE refresh_token IS NOT NULL
                    AND refresh_token_expire_at >= CURRENT_TIMESTAMP
                LIMIT 1
            `);
            //const refreshToken = "d8b81902-c536-414f-9ec1-14561d15a2c1";

            await makeServiceRequest({
                port,
                actionName: "refreshToken",
                headers: {
                    cookie: Cookie.serialize("refresh_token", user.refreshToken)
                }
            });

            const newLastActiveAt = (await service.db.pg.oneFirst(service.db.sql`
                SELECT last_active_at
                FROM users
                WHERE id = ${user.id};
            `)) as string;

            expect(dayjs(newLastActiveAt).valueOf()).toBeGreaterThan(dayjs(user.lastActiveAt || 0).valueOf());
        });
    });
});
