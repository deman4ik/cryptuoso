process.env.API_KEY = "TEST_KEY";

import Service from "../app/service";
import { StatsCalcJob } from "@cryptuoso/stats-calc-events";
import { User, UserStatus, UserRoles } from "@cryptuoso/user-state";
import { makeServiceRequest, getProperty, setProperty } from "@cryptuoso/test-helpers";
import { pg } from "@cryptuoso/postgres";
import { v4 as uuid } from "uuid";

const mockExit = jest.fn();
setProperty(process, "exit", mockExit);

const mockPG = {
    maybeOne: pg.maybeOne as jest.Mock,
    any: pg.any as jest.Mock
};

jest.mock("slonik", () => ({
    createTypeParserPreset: jest.fn(() => []),
    createPool: jest.fn(() => {
        return {
            maybeOne: jest.fn(),
            any: jest.fn(),
            query: jest.fn()
        };
    }),
    sql: jest.fn()
}));
jest.mock("ioredis");
jest.mock("@cryptuoso/logger");
//jest.mock("@cryptuoso/postgres");
jest.mock("@cryptuoso/events");

const routes: {
    [key: string]: {
        handlerName: string;
        roles: UserRoles[];
        requiredInput: StatsCalcJob;
        optionalInput: StatsCalcJob;
    };
} = {
    calcUserSignal: {
        handlerName: "handleCalcUserSignalEvent",
        roles: [UserRoles.admin],
        requiredInput: { userId: uuid(), robotId: uuid() },
        optionalInput: { calcAll: false }
    },
    calcUserSignals: {
        handlerName: "handleCalcUserSignalsEvent",
        roles: [UserRoles.admin],
        requiredInput: { userId: uuid() },
        optionalInput: { calcAll: false }
    },
    calcRobot: {
        handlerName: "handleStatsCalcRobotEvent",
        roles: [UserRoles.admin],
        requiredInput: { robotId: uuid() },
        optionalInput: { calcAll: false }
    },
    calcRobots: {
        handlerName: "handleStatsCalcRobotsEvent",
        roles: [UserRoles.admin],
        requiredInput: {},
        optionalInput: { calcAll: false }
    },
    calcUserRobot: {
        handlerName: "handleStatsCalcUserRobotEvent",
        roles: [UserRoles.admin],
        requiredInput: { userRobotId: uuid() },
        optionalInput: { calcAll: false }
    },
    calcUserRobots: {
        handlerName: "handleStatsCalcUserRobotsEvent",
        roles: [UserRoles.admin],
        requiredInput: { userId: uuid() },
        optionalInput: { exchange: "e", asset: "a", calcAll: false }
    },
    recalcAllRobots: {
        handlerName: "handleRecalcAllRobotsEvent",
        roles: [UserRoles.admin],
        requiredInput: {},
        optionalInput: { exchange: "e", asset: "a", currency: "c", strategy: "s" }
    },
    recalcAllUserSignals: {
        handlerName: "handleRecalcAllUserSignalsEvent",
        roles: [UserRoles.admin],
        requiredInput: {},
        optionalInput: {
            userId: uuid(),
            robotId: uuid(),
            exchange: "e",
            asset: "a",
            currency: "c",
            strategy: "s"
        }
    },
    recalcAllUserRobots: {
        handlerName: "handleRecalcAllUserRobotsEvent",
        roles: [UserRoles.admin],
        requiredInput: {},
        optionalInput: {
            userId: uuid(),
            robotId: uuid(),
            exchange: "e",
            asset: "a",
            currency: "c",
            strategy: "s"
        }
    }
};

async function testRoute({
    service,
    name,
    role,
    input,
    handlerName,
    responseError,
    responseStatus
}: {
    service: Service;
    name: string;
    role?: UserRoles;
    input?: StatsCalcJob;
    handlerName?: string;
    responseError?: any;
    responseStatus?: number;
}) {
    const dbUser: User = {
        id: uuid(),
        status: UserStatus.enabled,
        access: 15,
        roles: {
            defaultRole: role,
            allowedRoles: [role]
        },
        settings: null
    };

    let mockHandler: jest.Mock;

    if (handlerName) {
        mockHandler = getProperty(service, handlerName);
        mockHandler.mockClear();
    }

    mockPG.maybeOne.mockImplementation(async () => dbUser);

    const res = await makeServiceRequest({
        port: +getProperty(service, "_port"),
        actionName: name,
        userId: dbUser.id,
        input,
        role
    });

    try {
        if (handlerName) {
            expect(mockHandler).toBeCalledTimes(1);
            expect(mockHandler.mock.calls[0][0]).toEqual(expect.objectContaining(input));
        }

        if (responseError) expect(res.parsedBody).toStrictEqual(responseError);

        if (responseStatus) expect(res.status).toStrictEqual(responseStatus);
    } catch (err) {
        throw { res, err };
    }

    return res;
}

jest.setTimeout(4e4);

describe("E2E testing of StatisticCalcRunnerService class", () => {
    let config: { port: number };
    let service: Service;

    beforeAll(async (cb) => {
        for (const schema of Object.values(routes)) setProperty(Service.prototype, schema.handlerName, jest.fn());

        config = { port: 5679 };
        service = new Service(config);

        await service.startService();

        cb();
    });

    describe("constructor", () => {
        it("Should initialize all routes", () => {
            const _routes = getProperty(service, "_routes");

            Object.keys(routes).forEach((route) => {
                try {
                    expect(`/actions/${route}` in _routes).toBeTruthy();
                } catch (err) {
                    throw new Error(`Route "${route}" (at "/actions/") must be initialized: ${err}`);
                }
            });
        });
    });

    describe("Testing requests w/o x-hasura-role", () => {
        test("Should answer with error (code 400)", async () => {
            for (const [route, schema] of Object.entries(routes)) {
                if (schema.roles.length > 0) {
                    try {
                        await testRoute({
                            service,
                            name: route,
                            responseStatus: 400
                        });
                    } catch (err) {
                        throw new Error(`Wrong answer from route "${route}": ${err}`);
                    }
                }
            }
        });
    });

    describe("Testing requests with wrong DB user roles and right input", () => {
        test("Should answer with errors (code 403)", async () => {
            for (const [route, schema] of Object.entries(routes)) {
                if (schema.roles.length > 0) {
                    try {
                        await testRoute({
                            service,
                            name: route,
                            role: uuid() as UserRoles,
                            input: schema.requiredInput,
                            responseStatus: 403
                        });
                    } catch (err) {
                        throw new Error(`Wrong answer from route "${route}": ${err}`);
                    }
                }
            }
        });
    });

    describe("Testing requests with right meta but with optional input only", () => {
        test("Should answer with errors (code 400)", async () => {
            for (const [route, schema] of Object.entries(routes)) {
                if (Object.keys(schema.requiredInput).length > 0) {
                    try {
                        await testRoute({
                            service,
                            name: route,
                            role: schema.roles[0],
                            input: schema.optionalInput,
                            responseStatus: 400
                        });
                    } catch (err) {
                        throw new Error(`Wrong answer from route "${route}": ${err}`);
                    }
                }
            }
        });
    });

    describe("Testing right requests (requiredInput only)", () => {
        test("Should call handlers and answers w/o errors (code 200)", async () => {
            for (const [route, schema] of Object.entries(routes)) {
                try {
                    await testRoute({
                        service,
                        name: route,
                        role: schema.roles[0],
                        input: schema.requiredInput,
                        handlerName: schema.handlerName,
                        responseStatus: 200
                    });
                } catch (err) {
                    throw new Error(`Wrong answer from route "${route}": ${err}`);
                }
            }
        });
    });

    describe("Testing right requests (full input set)", () => {
        test("Should call handlers and answers w/o errors (code 200)", async () => {
            for (const [route, schema] of Object.entries(routes)) {
                try {
                    await testRoute({
                        service,
                        name: route,
                        role: schema.roles[0],
                        input: { ...schema.requiredInput, ...schema.optionalInput },
                        handlerName: schema.handlerName,
                        responseStatus: 200
                    });
                } catch (err) {
                    throw new Error(`Wrong answer from route "${route}": ${err}`);
                }
            }
        });
    });
});
