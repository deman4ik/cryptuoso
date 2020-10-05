// TODO: Check existing of user_signals.volume field

import Service from "../app/service";
import { getProperty, makeServiceRequest } from "@cryptuoso/test-helpers";
import { User, UserRoles, UserExchangeAccountState } from "@cryptuoso/user-state";
import { formatExchange, round, sleep } from "@cryptuoso/helpers";
import { Events } from "@cryptuoso/events";
import { StatsCalcRunnerEvents } from "@cryptuoso/stats-calc-events";
import { UserSignalState } from "@cryptuoso/user-signal-state";
import { RobotVolumeType, UserSignalSettings, UserRobotSettings, UserRobotVolumeType } from "@cryptuoso/robot-settings";
import { v4 as uuid } from "uuid";
import { UserRobotDB, UserRobotState } from "@cryptuoso/user-robot-state";

jest.setTimeout(50000);

describe("UserProfile service E2E", () => {
    const service = new Service();
    const port = getProperty(service, "_port");

    const userId = "13b09911-61b4-487d-b558-a73c366af0a2";
    const robotId = "270983c2-0e96-45ba-9234-a97296a3e95b";
    const userExAccId = uuid();
    let userRobotId: string;
    const volume = round(Math.random(), 3);
    const volumeInCurrency = round(10 + 10 * Math.random(), 3);
    let exchange: string;

    console.warn("userExAccId: ", userExAccId);

    let user: User;

    const getUserSignal = async (): Promise<UserSignalState> => {
        return await service.db.pg.maybeOne(service.db.sql`
            SELECT *
            FROM user_signals
            WHERE user_id = ${userId}
                AND robot_id = ${robotId};
        `);
    };

    const getLastUserSignalSettings = async (): Promise<{
        volumeType: RobotVolumeType;
        volume?: number;
        volumeInCurrency?: number;
    }> => {
        return (await service.db.pg.maybeOneFirst(service.db.sql`
            SELECT uss.signal_settings
            FROM user_signals us, v_user_signal_settings uss
            WHERE us.user_id = ${userId}
                AND us.robot_id = ${robotId}
                AND uss.user_signal_id = us.id;
        `)) as any;
    };

    const getUserExAcc = async (): Promise<UserExchangeAccountState> => {
        return await service.db.pg.maybeOne(service.db.sql`
            SELECT *
            FROM user_exchange_accs
            WHERE id = ${userExAccId};
        `);
    };

    const getUserRobot = async (): Promise<UserRobotDB> => {
        return await service.db.pg.maybeOne(service.db.sql`
            SELECT *
            FROM user_robots
            WHERE id = ${userRobotId};
        `);
    };

    const getLastUserRobotSettings = async (): Promise<{
        volumeType: RobotVolumeType;
        volume?: number;
        volumeInCurrency?: number;
        balancePercent?: number;
    }> => {
        return (await service.db.pg.maybeOneFirst(service.db.sql`
            SELECT user_robot_settings
            FROM v_user_robot_settings
            WHERE user_robot_id = ${userRobotId};
        `)) as any;
    };

    beforeAll(async (done) => {
        await service.startService();

        const signal = await getUserSignal();

        if (signal) {
            console.warn(`Signal already exists: user - ${userId}, robot - ${robotId}`);
            process.exit(1);
        }

        user = await service.db.pg.maybeOne(service.db.sql`
            SELECT *
            FROM users
            WHERE id = ${userId};
        `);

        console.log(user);

        if (!user) {
            console.warn(`User doesn't exists: ${userId}`);
            process.exit(1);
        }

        exchange = (await service.db.pg.oneFirst(service.db.sql`
            SELECT exchange
            FROM robots
            WHERE id = ${robotId};
        `)) as any;

        done();
    });

    describe("User Exchange Account Inserting (with name)", () => {
        test("", async () => {
            expect(await getUserExAcc()).toBeNull();

            const name = uuid();

            const res = await makeServiceRequest({
                port,
                actionName: "userExchangeAccUpsert",
                userId,
                role: UserRoles.user,
                input: {
                    id: userExAccId,
                    name,
                    exchange,
                    keys: {
                        key: "123",
                        secret: "123"
                    }
                }
            });

            //console.log(res);

            expect(res.parsedBody.result).toBe(name);

            const userExAcc = await getUserExAcc();

            expect(userExAcc).not.toBeNull();
            expect(userExAcc.name).toBe(res.parsedBody.result);
            expect(userExAcc.id).toBe(userExAccId);
            expect(userExAcc.userId).toBe(userId);
        });
    });

    describe("User Exchange Account Deleting (with name)", () => {
        test("", async () => {
            expect(await getUserExAcc()).not.toBeNull();

            const res = await makeServiceRequest({
                port,
                actionName: "userExchangeAccDelete",
                userId,
                role: UserRoles.user,
                input: {
                    id: userExAccId
                }
            });

            //console.log(res);

            expect(res.parsedBody.result).toBe("OK");

            expect(await getUserExAcc()).toBeNull();
        });
    });

    describe("User Exchange Account Inserting", () => {
        test("", async () => {
            expect(await getUserExAcc()).toBeNull();

            const res = await makeServiceRequest({
                port,
                actionName: "userExchangeAccUpsert",
                userId,
                role: UserRoles.user,
                input: {
                    id: userExAccId,
                    exchange,
                    keys: {
                        key: "123",
                        secret: "123"
                    }
                }
            });

            //console.log(res);

            expect(res.parsedBody.result.startsWith(formatExchange(exchange))).toBeTruthy();

            const userExAcc = await getUserExAcc();

            expect(userExAcc).not.toBeNull();
            expect(userExAcc.name).toBe(res.parsedBody.result);
            expect(userExAcc.id).toBe(userExAccId);
            expect(userExAcc.userId).toBe(userId);
        });
    });

    describe("User Exchange Account Upserting", () => {
        test("", async () => {
            expect(await getUserExAcc()).not.toBeNull();

            const name = "SomeNewName";

            const res = await makeServiceRequest({
                port,
                actionName: "userExchangeAccUpsert",
                userId,
                role: UserRoles.user,
                input: {
                    id: userExAccId,
                    name,
                    exchange,
                    keys: {
                        key: "123",
                        secret: "123"
                    }
                }
            });

            //console.log(res);

            expect(res.parsedBody.result).toBe(name);

            const userExAcc = await getUserExAcc();

            expect(userExAcc.name).toBe(res.parsedBody.result);
            expect(userExAcc).not.toBeNull();
            expect(userExAcc.id).toBe(userExAccId);
            expect(userExAcc.userId).toBe(userId);
        });
    });

    describe("User Robot Creating", () => {
        test("", async () => {
            const res = await makeServiceRequest({
                port,
                actionName: "userRobotCreate",
                userId,
                role: UserRoles.user,
                input: {
                    userExAccId,
                    robotId,
                    settings: {
                        volumeType: RobotVolumeType.assetStatic,
                        volume
                    }
                }
            });

            //console.log(res);

            expect(res.parsedBody.result).not.toBe("OK");

            userRobotId = res.parsedBody.result;

            const userRobot = await getUserRobot();

            expect(userRobot).not.toBeNull();
            expect(userRobot.userExAccId).toBe(userExAccId);
            expect(userRobot.userId).toBe(userId);
            expect(userRobot.robotId).toBe(robotId);
        });
    });

    describe("User Robot Editing", () => {
        test("", async () => {
            const balancePercent = 1 + 99 * Math.random();

            const res = await makeServiceRequest({
                port,
                actionName: "userRobotEdit",
                userId,
                role: UserRoles.user,
                input: {
                    id: userRobotId,
                    settings: {
                        volumeType: UserRobotVolumeType.balancePercent,
                        balancePercent
                    }
                }
            });

            //console.log(res);

            expect(res.parsedBody.result).toBe("OK");

            const UserRobotSettings = await getLastUserRobotSettings();

            expect(UserRobotSettings).not.toBeNull();
            expect(UserRobotSettings.volumeType).toBe(UserRobotVolumeType.balancePercent);
            expect(UserRobotSettings.balancePercent).toBe(balancePercent);
        });
    });

    describe("User Robot Deleting", () => {
        test("", async () => {
            const events = new Events(service.redis.duplicate(), service.lightship);
            const eventHandler = jest.fn();

            events.subscribe({
                [StatsCalcRunnerEvents.USER_ROBOT_DELETED]: {
                    group: "1",
                    handler: eventHandler
                }
            });

            await events.start();

            const res = await makeServiceRequest({
                port,
                actionName: "userRobotDelete",
                userId,
                role: UserRoles.user,
                input: {
                    id: userRobotId
                }
            });

            //console.log(res);

            await sleep(3000);

            events.closeConnections();

            expect(res.parsedBody.result).toBe("OK");

            expect(await getUserRobot()).toBeNull();
            expect(eventHandler).toBeCalledWith({ userId, robotId });
        });
    });

    describe("User Exchange Account Name Changing", () => {
        test("", async () => {
            const name = Math.random().toString();

            const res = await makeServiceRequest({
                port,
                actionName: "userExchangeAccChangeName",
                userId,
                role: UserRoles.user,
                input: {
                    id: userExAccId,
                    name
                }
            });

            //console.log(res);

            expect(res.parsedBody.result).toBe("OK");

            expect((await getUserExAcc()).name).toBe(name);
        });
    });

    describe("User Exchange Account Deleting", () => {
        test("", async () => {
            expect(await getUserExAcc()).not.toBeNull();

            const res = await makeServiceRequest({
                port,
                actionName: "userExchangeAccDelete",
                userId,
                role: UserRoles.user,
                input: {
                    id: userExAccId
                }
            });

            //console.log(res);

            expect(res.parsedBody.result).toBe("OK");

            expect(await getUserExAcc()).toBeNull();
        });
    });

    describe("User Signal Subscribing", () => {
        test("", async () => {
            expect(await getUserSignal()).toBeNull();
            expect(await getLastUserSignalSettings()).toBeNull();

            const res = await makeServiceRequest({
                port,
                actionName: "userSignalSubscribe",
                userId,
                role: UserRoles.user,
                input: {
                    robotId,
                    settings: {
                        volumeType: RobotVolumeType.assetStatic,
                        volume
                    }
                }
            });

            //console.log(res);

            expect(res.parsedBody.result).toBe("OK");

            expect((await getLastUserSignalSettings()).volume).toBe(volume);
        });
    });

    describe("User Signal Editing (change volume)", () => {
        test("", async () => {
            const newVolume = volume + 1;

            const res = await makeServiceRequest({
                port,
                actionName: "userSignalEdit",
                userId,
                role: UserRoles.user,
                input: {
                    robotId,
                    settings: {
                        volumeType: RobotVolumeType.assetStatic,
                        volume: newVolume
                    }
                }
            });

            expect(res.parsedBody.result).toBe("OK");
            expect((await getLastUserSignalSettings()).volume).toBe(newVolume);
        });
    });

    describe("User Signal Editing (change volumeType)", () => {
        test("", async () => {
            const res = await makeServiceRequest({
                port,
                actionName: "userSignalEdit",
                userId,
                role: UserRoles.user,
                input: {
                    robotId,
                    settings: {
                        volumeType: RobotVolumeType.currencyDynamic,
                        volumeInCurrency
                    }
                }
            });

            expect(res.parsedBody.result).toBe("OK");
            expect((await getLastUserSignalSettings()).volumeInCurrency).toBe(volumeInCurrency);
        });
    });

    describe("User Signal Unsubscribing", () => {
        test("", async () => {
            const events = new Events(service.redis.duplicate(), service.lightship);
            const eventHandler = jest.fn();

            events.subscribe({
                [StatsCalcRunnerEvents.USER_SIGNAL_DELETED]: {
                    group: "2",
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

            await sleep(5000);

            events.closeConnections();

            expect(res.parsedBody.result).toBe("OK");
            expect(eventHandler).toBeCalledWith({ userId, robotId });
            expect(await getUserSignal()).toBeNull();
            expect(await getLastUserSignalSettings()).toBeNull();
        });
    });
});
