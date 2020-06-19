import { EventsCatalog, Event } from "./catalog";
import util from "util";

//util.inspect(obj, false, null, true)
let catalog: EventsCatalog;
const handler = async (event: Event | any): Promise<void> => {};
process.env.SERVICE = "importer";
describe("Test 'EventsCatalog'", () => {
    beforeEach(() => {
        catalog = new EventsCatalog();
    });
    describe("Test 'add'", () => {
        it("Should add grouped event handler", () => {
            catalog.add({
                "importer.start": {
                    handler,
                    passFullEvent: true
                }
            });

            const events = catalog.grouped;
            expect(events).toHaveProperty("cpz:events:importer");
            expect(events["cpz:events:importer"]).toHaveProperty("importer");
            expect(Object.keys(events["cpz:events:importer"]["importer"].subs)).toStrictEqual([
                "com.cryptuoso.importer.start"
            ]);
            expect(events["cpz:events:importer"]["importer"].subs["com.cryptuoso.importer.start"]).toHaveProperty(
                "handler"
            );
            expect(events["cpz:events:importer"]["importer"].subs["com.cryptuoso.importer.start"]).toHaveProperty(
                "validate"
            );
            expect(
                events["cpz:events:importer"]["importer"].subs["com.cryptuoso.importer.start"].passFullEvent
            ).toBeTruthy();
            expect(typeof events["cpz:events:importer"]["importer"].subs["com.cryptuoso.importer.start"].handler).toBe(
                "function"
            );
            expect(typeof events["cpz:events:importer"]["importer"].subs["com.cryptuoso.importer.start"].validate).toBe(
                "function"
            );
        });
        it("Should add unbalanced event handler", () => {
            catalog.add({
                "importer.start": {
                    unbalanced: true,
                    handler
                }
            });
            const events = catalog.unbalanced;
            expect(events).toHaveProperty("cpz:events:importer");
            expect(Object.keys(events["cpz:events:importer"].subs)).toStrictEqual(["com.cryptuoso.importer.start"]);
            expect(events["cpz:events:importer"].subs["com.cryptuoso.importer.start"]).toHaveProperty("handler");
            expect(events["cpz:events:importer"].subs["com.cryptuoso.importer.start"]).toHaveProperty("validate");
            expect(typeof events["cpz:events:importer"].subs["com.cryptuoso.importer.start"].handler).toBe("function");
            expect(typeof events["cpz:events:importer"].subs["com.cryptuoso.importer.start"].validate).toBe("function");
        });
        it("Should add event schema", () => {
            catalog.add({
                "importer.start": {
                    unbalanced: true,
                    handler,
                    schema: {
                        foo: "string"
                    }
                }
            });

            const events = catalog.unbalanced;
            expect(typeof events["cpz:events:importer"].subs["com.cryptuoso.importer.start"].validate).toBe("function");
        });
    });
    describe("Test get 'groups'", () => {
        it("Should returns groups list with topics", () => {
            catalog.add({
                "importer.start": {
                    handler
                },
                "importer.finished": {
                    handler
                },
                "trades.new": {
                    handler
                },
                "importer.stop": {
                    handler,
                    group: "newGroup"
                }
            });
            expect(catalog.groups).toStrictEqual([
                { topic: "cpz:events:importer", group: "importer" },
                { topic: "cpz:events:importer", group: "newGroup" },
                { topic: "cpz:events:trades", group: "importer" }
            ]);
        });
    });
    describe("Test get 'unbalancedTopics'", () => {
        it("Should return unbalanced topics list", () => {
            catalog.add({
                "importer.start": {
                    unbalanced: true,
                    handler
                },
                "importer.finished": {
                    unbalanced: true,
                    handler
                },
                "trades.new": {
                    unbalanced: true,
                    handler
                },
                "importer.stop": {
                    unbalanced: true,
                    handler
                }
            });
            expect(catalog.unbalancedTopics).toStrictEqual(["cpz:events:importer", "cpz:events:trades"]);
        });
    });
    describe("Test 'getGroupHandlers'", () => {
        it("Should return group handlers for event type", () => {
            catalog.add({
                "importer.start": {
                    handler
                },
                "importer.finished": {
                    handler
                },
                "trades.new": {
                    handler
                },
                "importer.stop": {
                    handler,
                    group: "newGroup"
                }
            });
            expect(
                catalog.getGroupHandlers("cpz:events:importer", "importer", "com.cryptuoso.importer.start").length
            ).toBe(1);
        });
    });
    describe("Test get 'getUnbalancedHandlers'", () => {
        it("Should return unbalanced topics list", () => {
            catalog.add({
                "importer.start": {
                    unbalanced: true,
                    handler
                },
                "importer.finished": {
                    unbalanced: true,
                    handler
                },
                "trades.new": {
                    unbalanced: true,
                    handler
                },
                "importer.stop": {
                    unbalanced: true,
                    handler
                }
            });
            expect(catalog.getUnbalancedHandlers("cpz:events:importer", "com.cryptuoso.importer.start").length).toBe(1);
        });
    });
});
