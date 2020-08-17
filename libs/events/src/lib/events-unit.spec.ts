import Redis from "ioredis";
import { createLightship } from "lightship";
import { Events, NewEvent } from "./events";
import { BASE_REDIS_PREFIX } from "./catalog";
import { CloudEvent as Event } from "cloudevents";
import { ValidationSchema } from "fastest-validator";

jest.mock("uuid", () => ({ v4: () => "id123" }));

const mockLightshipType = {
    isServerShuttingDown: () => false,
    createBeacon: jest.fn(() => ({ die: jest.fn() }))
};

jest.mock("lightship", () => ({
    LightshipType: jest.fn(() => mockLightshipType),
    createLightship: jest.fn(() => mockLightshipType)
}));

const unbalancedTopic = "cpz:events:trades",
    groupTopic = "cpz:events:importer",
    groupName = "importer";
const stringifiedUnbalancedEvent = JSON.stringify({
        type: "com.cryptuoso.foo",
        source: "events.cryptuoso.com"
    }),
    stringifiedGroupEvent = JSON.stringify({
        type: groupTopic,
        source: "events.cryptuoso.com"
    });
const mockXgroup = jest.fn(),
    mockXread = jest.fn(() => [
        [
            unbalancedTopic,
            [
                ["1250192301273-0", ["event", stringifiedUnbalancedEvent]],
                ["1250192301280-0", ["event", stringifiedUnbalancedEvent]]
            ]
        ]
    ]),
    mockXreadGroup = jest.fn(() => [
        [
            groupTopic,
            [
                ["1250192301273-1", ["event", stringifiedGroupEvent]],
                ["1250192301280-1", ["event", stringifiedGroupEvent]]
            ]
        ]
    ]),
    mockXpending = jest.fn(() => [["1256984818136-0", "consumer-123", "196415", "1"]]),
    mockXclaim = jest.fn(() => [groupTopic, ["1256984818136-0", ["event", stringifiedGroupEvent]]]),
    mockXack = jest.fn(),
    mockXadd = jest.fn();

function RedisConstructor() {
    return {
        duplicate: () => RedisConstructor(),
        xgroup: mockXgroup,
        xread: mockXread,
        xreadgroup: mockXreadGroup,
        xpending: mockXpending,
        xclaim: mockXclaim,
        xack: mockXack,
        xadd: mockXadd
    };
}
jest.mock("ioredis", () => () => RedisConstructor());

const mockAdd = jest.fn(),
    mockUnbalancedHandler = jest.fn(),
    mockUnbalancedValidate = jest.fn(() => true),
    mockGroupHandler = jest.fn(),
    mockGroupValidate = jest.fn(() => true);
jest.mock("./catalog", () => ({
    EventsCatalog: jest.fn(() => ({
        groups: [{ topic: "cpz:events:importer", group: "importer" }],
        unbalancedTopics: [unbalancedTopic],
        getGroupHandlers: () => [
            {
                handler: mockGroupHandler,
                validate: mockGroupValidate,
                passFullEvent: true
            }
        ],
        getUnbalancedHandlers: () => [
            {
                handler: mockUnbalancedHandler,
                validate: mockUnbalancedValidate,
                passFullEvent: true
            }
        ],
        add: mockAdd
    }))
}));
describe("Unit tests", () => {
    const redisClient = Redis();
    const lightship = createLightship();
    const events = new Events(redisClient, lightship);

    describe("Testing data transformation utils", () => {
        describe("Testing '_parseObjectResponse' method", () => {
            it("Should parse single redis message to object", () => {
                const msg = ["key1", "123", "key2", "foo", "key3", "bar"];
                const res = events._parseObjectResponse(msg);

                expect(res).toStrictEqual({ key1: 123, key2: "foo", key3: "bar" });

                const emptyRes = events._parseObjectResponse([]);
                expect(emptyRes).toStrictEqual({});
            });
        });

        describe("Testing '_parseMessageResponse' method", () => {
            it("Should parse message array to object", () => {
                const array: [string, string[]][] = [
                    ["message_1", ["key1", "123", "key2", "foo", "key3", "bar"]],
                    ["message_2", ["key1", "456", "key2", "bar", "key3", "tar"]],
                    ["message_3", ["key1", "789", "key2", "tar", "key3", "foo"]]
                ];
                const res = events._parseMessageResponse(array);
                expect(res).toStrictEqual([
                    { msgId: "message_1", data: { key1: 123, key2: "foo", key3: "bar" } },
                    { msgId: "message_2", data: { key1: 456, key2: "bar", key3: "tar" } },
                    { msgId: "message_3", data: { key1: 789, key2: "tar", key3: "foo" } }
                ]);
                const emptyRes = events._parseMessageResponse([]);
                expect(emptyRes).toStrictEqual([]);
            });
        });

        describe("Testing '_parseStreamResponse' method", () => {
            it("Should parse response of xread command to object", () => {
                const array: [string, [string, string[]][]][] = [
                    [
                        "stream1",
                        [
                            ["1293846129342-0", ["key1", "123", "key2", "foo", "key3", "bar"]],
                            ["1293846129345-0", ["key1", "456", "key2", "bar", "key3", "tar"]]
                        ]
                    ],
                    [
                        "stream2",
                        [
                            ["1293846129421-0", ["name", "John", "lastName", "Doe", "age", "44"]],
                            ["1293846130030-0", ["name", "Steve", "lastName", "Jobs", "age", "65"]]
                        ]
                    ]
                ];
                const res = events._parseStreamResponse(array);

                expect(res).toStrictEqual({
                    stream1: [
                        { msgId: "1293846129342-0", data: { key1: 123, key2: "foo", key3: "bar" } },
                        { msgId: "1293846129345-0", data: { key1: 456, key2: "bar", key3: "tar" } }
                    ],
                    stream2: [
                        { msgId: "1293846129421-0", data: { name: "John", lastName: "Doe", age: 44 } },
                        { msgId: "1293846130030-0", data: { name: "Steve", lastName: "Jobs", age: 65 } }
                    ]
                });
            });
        });

        describe("Testing '_parsePendingResponse' method", () => {
            describe("Input is not empty", () => {
                it("Should parse an array of pending messages to object", () => {
                    const arr = [
                        ["1256984818136-0", "consumer-1", "196415", "1"],
                        ["1256984818136-1", "consumer-2", "150952", "2"],
                        ["1256984818136-2", "consumer-3", "689124", "2"]
                    ];
                    const res = events._parsePendingResponse(arr);
                    expect(res).toStrictEqual([
                        { msgId: "1256984818136-0", consumer: "consumer-1", idleSeconds: 196, retries: 1 },
                        { msgId: "1256984818136-1", consumer: "consumer-2", idleSeconds: 151, retries: 2 },
                        { msgId: "1256984818136-2", consumer: "consumer-3", idleSeconds: 689, retries: 2 }
                    ]);
                });
            });
            describe("Input is empty", () => {
                expect(events._parsePendingResponse([])).toStrictEqual([]);
            });
        });

        describe("Testing '_parseEvents' method", () => {
            describe("Passing valid arguments", () => {
                it("Should return object with values of Event type", () => {
                    const eventArr: { msgId: string; data: { [key: string]: any } }[] = [
                        {
                            msgId: "1293846129342-0",
                            data: { event: { type: "com.cryptuoso.foo", source: "events.cryptuoso.com" } }
                        },
                        {
                            msgId: "1293846129344-0",
                            data: { event: { type: "com.cryptuoso.bar", source: "events.cryptuoso.com" } }
                        }
                    ];
                    const res = events._parseEvents(eventArr);
                    for (const key of Object.keys(res)) {
                        expect(res[key]).toBeInstanceOf(Event);
                    }
                });
            });
        });

        describe("Testing 'subscribe' method", () => {
            it("Should call #catalog.add once with the event provided", () => {
                const evt: {
                    [key: string]: {
                        group?: string;
                        unbalanced?: boolean;
                        handler: (event: Event) => Promise<void>;
                        schema?: ValidationSchema<any>;
                    };
                } = {
                    "foo.bar.tar": {
                        group: "group1",
                        handler: (event: Event) => new Promise(() => console.log(JSON.stringify(event)))
                    }
                };
                events.subscribe(evt);

                expect(mockAdd).toHaveBeenCalledWith(evt);
                expect(mockAdd).toHaveBeenCalledTimes(1);
            });
        });

        describe("Testing 'start' and data processing methods", () => {
            it("Should call xgroup and bind _recieve[...]Tick functions accordingly", () => {
                const isBound = (func: Function) => func.prototype === undefined;
                events.start();
                expect(mockXgroup).toHaveBeenCalledTimes(1);
                expect(isBound(events._receiveMessagesTick)).toBeTruthy();
                expect(isBound(events._receiveGroupMessagesTick)).toBeTruthy();
                expect(isBound(events._receivePendingGroupMessagesTick)).toBeTruthy();
            });

            describe("Testing data processing methods", () => {
                afterEach(() => {
                    jest.clearAllMocks();
                });
                describe("Testing '_receiveMessagesTick' method", () => {
                    it("Should call xread and associated unbalanced handler", async () => {
                        await events._receiveMessagesTick(unbalancedTopic);

                        expect(mockXread).toHaveBeenCalledTimes(1);
                        expect(mockUnbalancedHandler).toHaveBeenCalledTimes(2);
                        expect(mockUnbalancedValidate).toHaveBeenCalledTimes(2);
                    });
                });

                describe("Testing '_receiveGroupMessagesTick' method", () => {
                    it("Shoult call xreadgroup, associated group handler, xack", async () => {
                        await events._receiveGroupMessagesTick(groupTopic, groupName);

                        expect(mockXreadGroup).toHaveBeenCalledTimes(1);
                        expect(mockGroupHandler).toHaveBeenCalledTimes(2);
                        expect(mockGroupValidate).toHaveBeenCalledTimes(2);
                        expect(mockXack).toHaveBeenCalledTimes(2);
                    });
                });

                describe("Testing '__receivePendingGroupMessagesTick' method", () => {
                    it("Should call xpending, xclaim, associated group handler", async () => {
                        await events._receivePendingGroupMessagesTick(groupTopic, groupName);

                        expect(mockXpending).toHaveBeenCalledTimes(1);
                        expect(mockXclaim).toHaveBeenCalledTimes(1);
                        expect(mockGroupHandler).toHaveBeenCalledTimes(1);
                        expect(mockGroupValidate).toHaveBeenCalledTimes(1);
                    });
                });
            });
        });

        describe("Testing 'emit' method", () => {
            interface CustomType {
                foo: string;
                bar: number;
            }
            const eventName = "some-random-event",
                eventType = eventName + ".foo";
            const newEvent: NewEvent<CustomType> = {
                type: eventType,
                data: { foo: "foo", bar: 4 },
                subject: "lul"
            };
            it("Should call xadd with expected arguments", async () => {
                const expectedTopic = BASE_REDIS_PREFIX + eventName;

                await events.emit(newEvent);

                expect(mockXadd).toHaveBeenCalledTimes(1);

                const argumentCount = mockXadd.mock.calls[0].length;
                expect(argumentCount).toBe(10);

                // xadd syntax: xadd(stream, id, ...args)
                expect(mockXadd.mock.calls[0][0]).toStrictEqual(expectedTopic);

                // expected args: ["id", "...", "type", "...", "timestamp", "...", "event", "..."]
                const eventArgs = mockXadd.mock.calls[0].slice(2, argumentCount);

                const eventObj = JSON.parse(eventArgs[7]);

                expect(eventObj.type).toBe("com.cryptuoso." + newEvent.type);
                expect(eventObj.subject).toBe(newEvent.subject);
                expect(eventObj.data).toMatchObject(newEvent.data);
            });
        });
    });
});
