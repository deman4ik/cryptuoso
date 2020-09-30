//process.env.API_KEY = "api_key";

console.log(process.env.API_KEY, process.env.PGSC);

import Service from "../app/service";
import { getProperty, makeServiceRequest } from "@cryptuoso/test-helpers";
import { User, UserRoles } from '@cryptuoso/user-state';
import { round, sleep } from "@cryptuoso/helpers";
import { Events } from '@cryptuoso/events';
import { StatsCalcRunnerEvents } from '@cryptuoso/stats-calc-events';
import { UserSignalState } from '@cryptuoso/user-signal-state';

jest.setTimeout(30000);

describe("", () => {
    const service = new Service();
    const port = getProperty(service, "_port");

    const userId = "13b09911-61b4-487d-b558-a73c366af0a2";
    const robotId = "270983c2-0e96-45ba-9234-a97296a3e95b";
    const volume = round(Math.random(), 3);

    let user: User;
    
    const getUserSignal = async (): Promise<UserSignalState> => {
        return await service.db.pg.maybeOne(service.db.sql`
            SELECT *
            FROM user_signals
            WHERE user_id = ${userId}
                AND robot_id = ${robotId};
        `);
    }
    
    const getLastUserSignalSettings = async (): Promise<{ volume: number }> => {
        return await service.db.pg.maybeOneFirst(service.db.sql`
            SELECT uss.signal_settings
            FROM user_signals us, v_user_signal_settings uss
            WHERE us.user_id = ${userId}
                AND us.robot_id = ${robotId}
                AND uss.user_signal_id = us.id;
        `) as any;
    }

    beforeAll(async (done) => {
        await service.startService();

        const signal = await getUserSignal();

        if(signal) {
            console.warn(`Signal already exists: user - ${userId}, robot - ${robotId}`);
            process.exit(1);
        }

        user = await service.db.pg.maybeOne(service.db.sql`
            SELECT *
            FROM users
            WHERE id = ${userId};
        `);

        if(!user) {
            console.warn(`User doesn't exists: ${userId}`);
            process.exit(1);
        }

        done();
    });

    describe("Subscribing", () => {
        test("", async () => {
            expect(await getUserSignal()).toBeNull();
            expect(await getLastUserSignalSettings()).toBeNull();

            const res = await makeServiceRequest({
                port,
                actionName: "userSignalSubscribe",
                userId,
                role: UserRoles.user,
                input: { robotId, volume }
            });

            //console.log(res);

            expect(res.parsedBody.result).toBe("OK");
            
            expect((await getUserSignal()).volume).toBe(volume);
            expect((await getLastUserSignalSettings()).volume).toBe(volume);
        });
    });

    describe("Editing", () => {
        test("", async () => {
            const newVolume = volume + 1;

            const res = await makeServiceRequest({
                port,
                actionName: "userSignalEdit",
                userId,
                role: UserRoles.user,
                input: { robotId, volume: newVolume }
            });

            expect(res.parsedBody.result).toBe("OK");
            expect((await getUserSignal()).volume).toBe(newVolume);
            expect((await getLastUserSignalSettings()).volume).toBe(newVolume);
        });
    });

    describe("Unsubscribing", () => {
        test("", async () => {
            const events = new Events(service.redis, service.lightship);
            const eventHandler = jest.fn();

            events.subscribe({
                [StatsCalcRunnerEvents.USER_SIGNALS]: {
                    handler: eventHandler
                }
            });

            await events.start();

            const res = await makeServiceRequest({
                port,
                actionName: "userSignalUnsubscribe",
                userId,
                role: UserRoles.user,
                input: { robotId }
            });

            //console.log(res);

            await sleep(3000);

            expect(res.parsedBody.result).toBe("OK");
            expect(eventHandler).toBeCalledWith({ userId, calcAll: true });
            expect(await getUserSignal()).toBeNull();
            expect(await getLastUserSignalSettings()).toBeNull();
        });
    });
});
