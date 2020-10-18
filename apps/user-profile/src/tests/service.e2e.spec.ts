import Service from "../app/service";
import { getProperty, makeServiceRequest } from "@cryptuoso/test-helpers";
import { User, UserRoles, UserExchangeAccountState, UserExchangeAccStatus } from "@cryptuoso/user-state";
import { formatExchange, round, sleep } from "@cryptuoso/helpers";
import { Events } from "@cryptuoso/events";
import { StatsCalcRunnerEvents } from "@cryptuoso/stats-calc-events";
import { VolumeSettingsType } from "@cryptuoso/robot-settings";
import { v4 as uuid } from "uuid";
import { pg, sql } from "@cryptuoso/postgres";
import { UserMarketState } from "@cryptuoso/market";
import { RobotStatus } from "@cryptuoso/robot-state";

jest.setTimeout(50000);

const mockPG = {
    any: pg.any as jest.Mock,
    maybeOne: pg.maybeOne as jest.Mock,
    oneFirst: pg.oneFirst as jest.Mock,
    maybeOneFirst: pg.maybeOneFirst as jest.Mock,
    query: pg.query as jest.Mock
};

sql.json = jest.fn();

jest.mock("slonik", () => ({
    createTypeParserPreset: jest.fn(() => []),
    createPool: jest.fn(() => {
        return {
            maybeOne: jest.fn(),
            any: jest.fn(),
            oneFirst: jest.fn(),
            maybeOneFirst: jest.fn(),
            query: jest.fn()
        };
    }),
    sql: jest.fn()
}));

describe("UserProfile service E2E w/o DB", () => {
    const service = new Service();
    const port = getProperty(service, "_port");

    const userId = uuid();
    const robotId = uuid();
    const userExAccId = uuid();
    let userRobotId: string;
    const volume = round(1 + Math.random(), 3);
    const volumeInCurrency = round(10 + 10 * Math.random(), 3);
    const exchange = "exchange";

    const user: User = {
        id: userId,
        name: null,
        email: "example6@example.com",
        status: 1,
        passwordHash: null,
        refreshToken: null,
        roles: { defaultRole: UserRoles.user, allowedRoles: [UserRoles.user] },
        settings: {
            notifications: {
                signals: {
                    email: false,
                    telegram: false
                },
                trading: {
                    email: false,
                    telegram: false
                }
            }
        },
        // createdAt: "2020-07-29T12:37:02.621Z",
        telegramId: null,
        telegramUsername: null,
        // updatedAt: "2020-10-05T13:16:51.985Z",
        secretCodeExpireAt: null,
        refreshTokenExpireAt: null,
        secretCode: null,
        emailNew: null,
        passwordHashNew: null,
        lastActiveAt: "2020-10-05T13:16:51.985Z",
        access: 15
    };

    const userExAcc: UserExchangeAccountState = {
        id: userExAccId,
        userId,
        exchange,
        name: "name",
        status: UserExchangeAccStatus.disabled,
        keys: {
            key: {
                iv: "iv",
                data: "data"
            },
            pass: {
                iv: "iv",
                data: "data"
            },
            secret: {
                iv: "iv",
                data: "data"
            }
        },
        ordersCache: {}
    };

    const marketLimits: UserMarketState["limits"] = {
        userSignal: {
            min: { amount: 0.1, amountUSD: 10 },
            max: { amount: 200000, amountUSD: null }
        },
        userRobot: {
            min: { amount: 0.1, amountUSD: 20 },
            max: { amount: 200000, amountUSD: null }
        }
    };

    beforeAll(async (done) => {
        await service.startService();

        // WARNING: 120 second for test
        await service.redis.setex(`cpz:users:${userId}`, 120, JSON.stringify(user));

        done();
    });

    describe("User Exchange Account Inserting (with name)", () => {
        test("", async () => {
            const name = uuid();

            mockPG.maybeOne.mockClear();
            mockPG.query.mockClear();
            //mockPG.maybeOne.mockImplementationOnce(async () => user);
            mockPG.maybeOne.mockImplementationOnce(async () => null);
            mockPG.maybeOne.mockImplementationOnce(async () => null);

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

            expect(res.parsedBody.result).toBe(name);

            /* expect(mockPG.maybeOne).toBeCalledTimes(3);
            expect(mockPG.query).toBeCalledTimes(1); */
        });
    });

    describe("User Exchange Account Deleting (with name)", () => {
        test("", async () => {
            mockPG.maybeOne.mockClear();
            mockPG.oneFirst.mockClear();
            mockPG.query.mockClear();
            //mockPG.maybeOne.mockImplementationOnce(async () => user);
            mockPG.maybeOne.mockImplementationOnce(async () => userExAcc);
            mockPG.oneFirst.mockImplementationOnce(async () => "0");

            const res = await makeServiceRequest({
                port,
                actionName: "userExchangeAccDelete",
                userId,
                role: UserRoles.user,
                input: {
                    id: userExAccId
                }
            });

            expect(res.parsedBody.result).toBe("OK");

            /* expect(mockPG.maybeOne).toBeCalledTimes(2);
            expect(mockPG.oneFirst).toBeCalledTimes(1);
            expect(mockPG.query).toBeCalledTimes(1); */
        });
    });

    describe("User Exchange Account Inserting", () => {
        test("", async () => {
            mockPG.maybeOne.mockClear();
            mockPG.maybeOneFirst.mockClear();
            mockPG.query.mockClear();
            //mockPG.maybeOne.mockImplementationOnce(async () => user);
            mockPG.maybeOne.mockImplementationOnce(async () => null);
            mockPG.maybeOneFirst.mockImplementationOnce(async () => exchange);

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

            expect(mockPG.maybeOne).toBeCalled();
            expect(mockPG.maybeOneFirst).toBeCalled();
            expect(mockPG.query).toBeCalled();
        });
    });

    describe("User Exchange Account Upserting", () => {
        test("", async () => {
            mockPG.maybeOne.mockClear();
            mockPG.oneFirst.mockClear();
            mockPG.query.mockClear();
            //mockPG.maybeOne.mockImplementationOnce(async () => user);
            mockPG.maybeOne.mockImplementationOnce(async () => userExAcc);
            mockPG.oneFirst.mockImplementationOnce(async () => "0");

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

            expect(mockPG.maybeOne).toBeCalled();
            expect(mockPG.oneFirst).toBeCalled();
            expect(mockPG.query).toBeCalled();
        });
    });

    describe("User Robot Creating", () => {
        test("", async () => {
            mockPG.maybeOne.mockClear();
            mockPG.maybeOneFirst.mockClear();
            mockPG.query.mockClear();
            //mockPG.maybeOne.mockImplementationOnce(async () => user);
            mockPG.maybeOne.mockImplementationOnce(async () => userExAcc);
            mockPG.maybeOne.mockImplementationOnce(async () => null);
            mockPG.maybeOne.mockImplementationOnce(async () => ({ available: 20, exchange }));
            mockPG.maybeOneFirst.mockImplementationOnce(async () => marketLimits);
            mockPG.oneFirst.mockImplementationOnce(async () => "0");

            const res = await makeServiceRequest({
                port,
                actionName: "userRobotCreate",
                userId,
                role: UserRoles.user,
                input: {
                    userExAccId,
                    robotId,
                    settings: {
                        volumeType: VolumeSettingsType.assetStatic,
                        volume
                    }
                }
            });

            expect(res.parsedBody.result).not.toBe("OK");
            expect(res.parsedBody.result).not.toBeNull();

            //console.warn(res);

            userRobotId = res.parsedBody.result;

            expect(mockPG.maybeOne).toBeCalled();
            expect(mockPG.maybeOneFirst).toBeCalled();
            expect(mockPG.query).toBeCalled();
        });
    });

    describe("User Robot Editing (assetStatic -> balancePercent)", () => {
        test("", async () => {
            mockPG.maybeOne.mockClear();
            mockPG.maybeOneFirst.mockClear();
            mockPG.query.mockClear();
            //mockPG.maybeOne.mockImplementationOnce(async () => user);
            mockPG.maybeOne.mockImplementationOnce(async () => ({ userId }));
            mockPG.maybeOneFirst.mockImplementationOnce(async () => ({
                volumeType: VolumeSettingsType.assetStatic,
                volume
            }));
            mockPG.maybeOneFirst.mockImplementationOnce(async () => marketLimits);

            const balancePercent = 1 + 99 * Math.random();

            const res = await makeServiceRequest({
                port,
                actionName: "userRobotEdit",
                userId,
                role: UserRoles.user,
                input: {
                    id: userRobotId,
                    settings: {
                        volumeType: VolumeSettingsType.balancePercent,
                        balancePercent
                    }
                }
            });

            expect(res.parsedBody.result).toBe("OK");

            expect(mockPG.maybeOne).toBeCalled();
            expect(mockPG.maybeOneFirst).toBeCalled();
            expect(mockPG.query).toBeCalled();
        });
    });

    describe("User Robot Editing (balancePercent)", () => {
        test("", async () => {
            mockPG.maybeOne.mockClear();
            mockPG.maybeOneFirst.mockClear();
            mockPG.query.mockClear();
            //mockPG.maybeOne.mockImplementationOnce(async () => user);
            mockPG.maybeOne.mockImplementationOnce(async () => ({ userId }));
            mockPG.maybeOneFirst.mockImplementationOnce(async () => ({
                volumeType: VolumeSettingsType.balancePercent,
                balancePercent: 0
            }));
            mockPG.maybeOneFirst.mockImplementationOnce(async () => marketLimits);

            const balancePercent = 1 + 99 * Math.random();

            const res = await makeServiceRequest({
                port,
                actionName: "userRobotEdit",
                userId,
                role: UserRoles.user,
                input: {
                    id: userRobotId,
                    settings: {
                        volumeType: VolumeSettingsType.balancePercent,
                        balancePercent
                    }
                }
            });

            expect(res.parsedBody.result).toBe("OK");

            expect(mockPG.maybeOne).toBeCalled();
            expect(mockPG.maybeOneFirst).toBeCalled();
            expect(mockPG.query).toBeCalled();
        });
    });

    describe("User Robot Deleting", () => {
        test("", async () => {
            mockPG.maybeOne.mockClear();
            mockPG.query.mockClear();
            //mockPG.maybeOne.mockImplementationOnce(async () => user);
            mockPG.maybeOne.mockImplementationOnce(async () => ({ userId, status: RobotStatus.stopped, robotId }));

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

            //events.closeConnections();

            expect(res.parsedBody.result).toBe("OK");

            expect(mockPG.maybeOne).toBeCalled();
            expect(mockPG.query).toBeCalled();
            expect(eventHandler).toBeCalledWith({ userId, robotId });
        });
    });

    describe("User Exchange Account Name Changing", () => {
        test("", async () => {
            mockPG.maybeOne.mockClear();
            mockPG.query.mockClear();
            //mockPG.maybeOne.mockImplementationOnce(async () => user);
            mockPG.maybeOne.mockImplementationOnce(async () => ({ userId }));
            mockPG.maybeOne.mockImplementationOnce(async () => null);

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

            expect(mockPG.maybeOne).toBeCalled();
            expect(mockPG.query).toBeCalled();
        });
    });

    describe("User Exchange Account Deleting", () => {
        test("", async () => {
            mockPG.maybeOne.mockClear();
            mockPG.oneFirst.mockClear();
            mockPG.query.mockClear();
            //mockPG.maybeOne.mockImplementationOnce(async () => user);
            mockPG.maybeOne.mockImplementationOnce(async () => ({ userId }));
            mockPG.oneFirst.mockImplementationOnce(async () => "0");

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

            expect(mockPG.maybeOne).toBeCalled();
            expect(mockPG.oneFirst).toBeCalled();
            expect(mockPG.query).toBeCalled();
        });
    });

    describe("User Signal Subscribing", () => {
        test("", async () => {
            mockPG.maybeOne.mockClear();
            mockPG.maybeOneFirst.mockClear();
            mockPG.query.mockClear();
            //mockPG.maybeOne.mockImplementationOnce(async () => user);
            mockPG.maybeOne.mockImplementationOnce(async () => ({ available: 20 }));
            mockPG.maybeOneFirst.mockImplementationOnce(async () => marketLimits);

            const res = await makeServiceRequest({
                port,
                actionName: "userSignalSubscribe",
                userId,
                role: UserRoles.user,
                input: {
                    robotId,
                    settings: {
                        volumeType: VolumeSettingsType.assetStatic,
                        volume
                    }
                }
            });

            //console.log(res);

            expect(res.parsedBody.result).toBe("OK");

            expect(mockPG.maybeOne).toBeCalled();
            expect(mockPG.maybeOneFirst).toBeCalled();
            expect(mockPG.query).toBeCalled();
        });
    });

    describe("User Signal Editing (change volume)", () => {
        test("", async () => {
            const signalId = uuid();

            mockPG.maybeOne.mockClear();
            mockPG.maybeOneFirst.mockClear();
            mockPG.query.mockClear();
            //mockPG.maybeOne.mockImplementationOnce(async () => user);
            mockPG.maybeOne.mockImplementationOnce(async () => ({ id: signalId }));
            mockPG.maybeOneFirst.mockImplementationOnce(async () => ({
                volumeType: VolumeSettingsType.assetStatic,
                volume
            }));
            mockPG.maybeOneFirst.mockImplementationOnce(async () => marketLimits);

            const newVolume = volume + 1;

            const res = await makeServiceRequest({
                port,
                actionName: "userSignalEdit",
                userId,
                role: UserRoles.user,
                input: {
                    robotId,
                    settings: {
                        volumeType: VolumeSettingsType.assetStatic,
                        volume: newVolume
                    }
                }
            });

            expect(res.parsedBody.result).toBe("OK");

            expect(mockPG.maybeOne).toBeCalled();
            expect(mockPG.maybeOneFirst).toBeCalled();
            expect(mockPG.query).toBeCalled();
        });
    });

    describe("User Signal Editing (change volumeType)", () => {
        test("", async () => {
            const signalId = uuid();

            mockPG.maybeOne.mockClear();
            mockPG.maybeOneFirst.mockClear();
            mockPG.query.mockClear();
            //mockPG.maybeOne.mockImplementationOnce(async () => user);
            mockPG.maybeOne.mockImplementationOnce(async () => ({ id: signalId }));
            mockPG.maybeOneFirst.mockImplementationOnce(async () => ({
                volumeType: VolumeSettingsType.assetDynamicDelta,
                volumeInCurrency
            }));
            mockPG.maybeOneFirst.mockImplementationOnce(async () => marketLimits);

            await makeServiceRequest({
                port,
                actionName: "userSignalEdit",
                userId,
                role: UserRoles.user,
                input: {
                    robotId,
                    settings: {
                        volumeType: VolumeSettingsType.currencyDynamic,
                        volumeInCurrency
                    }
                }
            });

            expect(mockPG.maybeOne).toBeCalled();
            expect(mockPG.maybeOneFirst).toBeCalled();
            expect(mockPG.query).toBeCalled();
        });
    });

    describe("User Signal Unsubscribing", () => {
        test("", async () => {
            mockPG.maybeOne.mockClear();
            mockPG.query.mockClear();
            //mockPG.maybeOne.mockImplementationOnce(async () => user);
            mockPG.maybeOne.mockImplementationOnce(async () => ({ foo: "bar" }));

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

            await sleep(3000);

            //events.closeConnections();

            expect(res.parsedBody.result).toBe("OK");
            expect(eventHandler).toBeCalledWith({ userId, robotId });

            expect(mockPG.maybeOne).toBeCalled();
            expect(mockPG.query).toBeCalled();
        });
    });
});
