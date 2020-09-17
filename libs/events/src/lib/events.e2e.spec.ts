import "jest-extended";
import Redis from "ioredis";
import { createLightship } from "lightship";
import { Events, EventsConfig } from "./events";
import { sleep } from "@cryptuoso/helpers";
import { ValidationSchema } from "fastest-validator";
import { BASE_REDIS_PREFIX } from "./catalog";

//TODO: one service for all tests
const SERVICES = {
    deadLetter: "test-events-e2e-dead-letter",
    calc: "test-events-e2e-calc",
    calc2: "test-events-e2e-calc2",
    faultyGroupLog: "test-events-e2e-faulty-group-log",
    faultyGroupLog2: "test-events-e2e-faulty-group-log2",
    unbalancedLog: "test-events-e2e-unbalanced-log",
    groupLog: "test-events-e2e-group-log",
    messager: "test-events-e2e-messager",
    groupMessager: "test-events-e2e-group-messager"
};
const GROUPS = {
    testDataSupply: "test-events-e2e-group-data-supply",
    log: "test-events-e2e-group-log",
    testError: "test-events-e2e-group-error",
    testError2: "test-events-e2e-group-error2",
    sum: `${SERVICES.calc}-sum`,
    divide2: `${SERVICES.calc2}-divide`,
    subtract: `${SERVICES.calc}-substract`
};
jest.mock("tslog");
jest.setTimeout(40000);
const itif = (name: string, condition: () => boolean, cb: Function) => {
    it(name, (done) => {
        if (condition()) {
            cb(done);
        } else {
            console.warn(`[skipped]: ${name}`);
            done();
        }
    });
};
const calcSchema: ValidationSchema = {
    info: "string",
    numbers: { type: "array", items: "number" }
};

describe("E2E test", () => {
    const lightship = createLightship();
    const eventsConfig: EventsConfig = {
        deadLetterTopic: SERVICES.deadLetter,
        blockTimeout: 50,
        pendingMinIdleTime: 50,
        pendingRetryRate: -1,
        pendingMaxRetries: 1 // emit a dead-letter on firts pending handling failure
    };
    let redis: Redis.Redis;

    const clearEvents = async () => {
        if (redis) {
            for (const service of Object.values(SERVICES)) {
                await redis.del(`${BASE_REDIS_PREFIX}${service}`);
            }
        }
    };

    describe("Test Events workflow", () => {
        beforeAll((done) => {
            redis = new Redis({ port: 6379, host: "127.0.0.1" })
                .on("error", (err) => {
                    console.warn("Connection to redis could not be established.\n" + err);
                    redis?.quit();
                    redis = null;
                    done();
                })
                .on("end", () => {
                    console.warn("Error connecting to redis instance.");
                    redis?.quit();
                    redis = null;
                    done();
                })
                .on("ready", async () => {
                    await clearEvents();

                    done();
                });
        });

        afterAll(async (done) => {
            if (redis) {
                await clearEvents();
                await redis.quit();
            }
            done();
        });

        const findDeadLetter = async (type: string) => {
            const arr = await redis.xread("COUNT", 100, "STREAMS", `${BASE_REDIS_PREFIX}${SERVICES.deadLetter}`, "0");
            if (arr != [] && arr != null)
                return arr[0][1].filter((item) => {
                    const eventType = JSON.parse(item[1][7]).type;
                    return (
                        eventType ===
                        `com.cryptuoso.${SERVICES.deadLetter}.` +
                            type.split(".").slice(-type.split(".").length).join(".")
                    );
                });
            return [];
        };

        const testHandlerUnbalacedMessage = jest.fn(async ({ message }) => {
            //console.log(message);
        });
        describe("Single unbalanced subscriber scenario", () => {
            itif(
                "Should subscribe to event and process emitted data",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);

                    events.subscribe({
                        [SERVICES.messager]: {
                            unbalanced: true,
                            handler: testHandlerUnbalacedMessage
                        }
                    });

                    await events.start();
                    // wait for events to set all neccesary valiables e.g. last unbalanced id
                    await sleep(3000);

                    await events.emit({
                        type: SERVICES.messager,
                        data: { message: "This is a very cool message" }
                    });
                    await sleep(3000);

                    expect(testHandlerUnbalacedMessage).toHaveBeenCalledTimes(1);

                    events.closeConnections();
                    done();
                }
            );
        });

        const testHandlerGroupMessage = jest.fn(async ({ foo, bar }) => {
            //console.log("foo is " + foo + "\nbar is " + JSON.stringify(bar));
        });
        describe("Single group subscriber scenario", () => {
            itif(
                "Should subscribe to event and process emitted data",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);

                    events.subscribe({
                        [SERVICES.groupMessager]: {
                            group: GROUPS.testDataSupply,
                            handler: testHandlerGroupMessage
                        }
                    });

                    await events.start();

                    await sleep(3000);

                    await events.emit({
                        type: SERVICES.groupMessager,
                        data: {
                            foo: "bar",
                            bar: { 1: "one", 2: "two", 3: "three" }
                        }
                    });
                    await sleep(3000);

                    expect(testHandlerGroupMessage).toHaveBeenCalledTimes(1);

                    events.closeConnections();
                    done();
                }
            );
        });

        const testHandlerUnbalancedLog = jest.fn(async (data) => {
            //console.log("The data object is:\n" + JSON.stringify(data));
        });
        describe("Subscribing after unbalanced event is emitted scenario", () => {
            itif(
                "Should subscribe and handle the event",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);

                    await events.emit({
                        type: SERVICES.unbalancedLog,
                        data: {
                            info: "This event is not to be processed"
                        }
                    });

                    events.subscribe({
                        [SERVICES.unbalancedLog]: {
                            unbalanced: true,
                            handler: testHandlerUnbalancedLog
                        }
                    });
                    await events.start();
                    await sleep(3000);

                    expect(testHandlerUnbalancedLog).not.toHaveBeenCalled();

                    events.closeConnections();
                    done();
                }
            );
        });

        const testHandlerGroupLog = jest.fn(async ({ info }) => {
            //console.log(info);
        });
        describe("Subscribing after event is emitted scenario", () => {
            itif(
                "Should subscribe and handle the event",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);

                    await events.emit({
                        type: SERVICES.groupLog,
                        data: {
                            info: "This event is supposed to be processed"
                        }
                    });
                    await sleep(5000);

                    events.subscribe({
                        [SERVICES.groupLog]: {
                            group: GROUPS.log,
                            handler: testHandlerGroupLog
                        }
                    });
                    await events.start();
                    await sleep(5000);

                    expect(testHandlerGroupLog).toHaveBeenCalledTimes(1);

                    events.closeConnections();
                    done();
                }
            );
        });

        const testHandlerFaulty = jest.fn((data) => {
            throw new Error("Cannot process the data:\n" + data);
        });
        describe("Error in a group event handler scenario", () => {
            itif(
                "Should call the handler two times",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);

                    events.subscribe({
                        [SERVICES.faultyGroupLog]: {
                            group: GROUPS.testError,
                            handler: testHandlerFaulty
                        }
                    });
                    await events.start();
                    await sleep(3000);

                    await events.emit({
                        type: SERVICES.faultyGroupLog,
                        data: {
                            foo: "bar"
                        }
                    });
                    await sleep(15000);
                    expect(testHandlerFaulty).toHaveBeenCalledTimes(2);

                    events.closeConnections();
                    done();
                }
            );
        });

        describe("Error in a group event handler scenario", () => {
            itif(
                "Should emit a dead-letter",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);

                    events.subscribe({
                        [SERVICES.faultyGroupLog2]: {
                            group: GROUPS.testError2,
                            handler: testHandlerFaulty
                        }
                    });
                    await events.start();
                    await sleep(3000);

                    await events.emit({
                        type: SERVICES.faultyGroupLog2,
                        data: {
                            foo: "bar"
                        }
                    });
                    await sleep(3000);

                    await events._receivePendingGroupMessagesTick(
                        `${BASE_REDIS_PREFIX}${SERVICES.faultyGroupLog2}`,
                        GROUPS.testError2
                    );
                    await sleep(15000);

                    const letters = await findDeadLetter(SERVICES.faultyGroupLog2);

                    expect(letters.length).toBe(1);
                    events.closeConnections();
                    done();
                }
            );
        });

        const testHandlerSum = jest.fn(async ({ info, numbers }) => {
                const sum = numbers.reduce((acc: number, n: number) => acc + n, 0);
                //console.log(info + "\nSum of numbers is " + sum);
            }),
            testHandlerSumLog = jest.fn(async (data) => {
                //console.log("This event will be logged\n" + "The data object is:\n" + JSON.stringify(data));
            });
        describe("Multiple subscribers scenario", () => {
            itif(
                "Should subscribe to the same stream and process event for each subscription",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);
                    const type = `${SERVICES.calc}.sum`;
                    const typeParentAll = `${SERVICES.calc}.*`;

                    events.subscribe({
                        [type]: {
                            group: GROUPS.sum,
                            handler: testHandlerSum,
                            schema: calcSchema
                        },
                        [typeParentAll]: {
                            group: GROUPS.sum,
                            handler: testHandlerSumLog
                        }
                    });
                    await events.start();
                    await sleep(3000);

                    await events.emit({
                        type,
                        data: {
                            info: "Calculate a sum",
                            numbers: [1, 2, 3, 4, 5]
                        }
                    });
                    await sleep(3000);

                    expect(testHandlerSum).toHaveBeenCalledTimes(1);
                    expect(testHandlerSumLog).toHaveBeenCalledTimes(1);

                    expect(testHandlerSumLog).toHaveBeenCalledAfter(testHandlerSum);
                    events.closeConnections();
                    done();
                }
            );
        });

        const testHandlerDivide = jest.fn(async () => {
                throw new Error("This error is expected");
            }),
            testHandlerDivideLog = jest.fn(async (data) => {
                //console.log("This event will be logged\n" + "The data object is:\n" + JSON.stringify(data));
            });
        describe("Handling pending event with handling error in one of the subs", () => {
            itif(
                "Should call only firts handler once per start() and _receive[...]",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);
                    const type = `${SERVICES.calc2}.divide`;
                    const typeParentAll = `${SERVICES.calc2}.*`;

                    events.subscribe({
                        [type]: {
                            group: GROUPS.divide2,
                            handler: testHandlerDivide
                        },
                        [typeParentAll]: {
                            group: GROUPS.divide2,
                            handler: testHandlerDivideLog
                        }
                    });
                    await events.start();
                    await sleep(3000);

                    await events.emit({
                        type,
                        data: {
                            info: "This is a faulty event, error is expected"
                        }
                    });
                    await sleep(15000);

                    expect(testHandlerDivide).toHaveBeenCalledTimes(2);
                    expect(testHandlerDivideLog).toHaveBeenCalledTimes(0);

                    events.closeConnections();
                    done();
                }
            );
        });

        const testHandlerSubstract = jest.fn(async () => {
            console.error("This should not have been called");
        });
        describe("Handling group event with validation error", () => {
            itif(
                "Should emit a dead-letter event",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);
                    const type = `${SERVICES.calc}.group-substract`;

                    events.subscribe({
                        [type]: {
                            group: GROUPS.subtract,
                            handler: testHandlerSubstract,
                            schema: calcSchema
                        }
                    });
                    await events.start();

                    await sleep(3000);

                    await events.emit({
                        type,
                        data: { msg: "This message is not expected" }
                    });
                    await sleep(3000);

                    const deadLetters = await findDeadLetter(type);
                    await sleep(3000);

                    expect(deadLetters.length).toBe(1);
                    expect(testHandlerSubstract).not.toHaveBeenCalled();
                    events.closeConnections();
                    done();
                }
            );
        });

        const testHandlerUnbalancedSubstract = jest.fn(async () => {
            console.error("This should not have been called");
        });
        describe("Handling unbalanced event with validation error", () => {
            itif(
                "Should emit a dead-letter event",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);

                    const type = `${SERVICES.calc}.unbalanced-substract`;

                    events.subscribe({
                        [type]: {
                            unbalanced: true,
                            handler: testHandlerUnbalancedSubstract,
                            schema: calcSchema
                        }
                    });
                    await events.start();

                    await sleep(3000);

                    await events.emit({
                        type,
                        data: { msg: "This message is not expected" }
                    });
                    await sleep(3000);

                    const deadLetters = await findDeadLetter(`${SERVICES.calc}.unbalanced-substract`);
                    await sleep(3000);

                    expect(deadLetters.length).toBe(1);
                    expect(testHandlerUnbalancedSubstract).not.toHaveBeenCalled();

                    events.closeConnections();
                    done();
                }
            );
        });
    });
});
