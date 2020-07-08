import Validator, { ValidationSchema, ValidationError } from "fastest-validator";
import { CloudEvent as Event } from "cloudevents-sdk/lib/cloudevent";
import { flattenArray } from "@cryptuoso/helpers";
export { Event };
export type EventHandler = {
    passFullEvent: boolean;
    handler: (event: { [key: string]: any }) => Promise<void>;
    validate: (value: any) => true | ValidationError[];
};
export const BASE_REDIS_PREFIX = "cpz:events:";
const CLOUD_EVENTS_SCHEMA = {
    id: "uuid",
    time: { type: "string" },
    source: "string",
    type: "string",
    subject: { type: "string", optional: true },
    data: "object"
};

export class EventsCatalog {
    #v: Validator;

    #grouped: {
        [topicName: string]: {
            [groupName: string]: {
                subs: {
                    [eventName: string]: EventHandler;
                };
            };
        };
    } = {};

    #unbalanced: {
        [topicName: string]: {
            subs: {
                [eventName: string]: EventHandler;
            };
        };
    } = {};

    #RegexCache = new Map();
    constructor() {
        this.#v = new Validator();
    }

    _match(text: string, pattern: string): boolean {
        if (pattern.indexOf("?") == -1) {
            // Exact match (eg. "prefix.event")
            const firstStarPosition = pattern.indexOf("*");
            if (firstStarPosition == -1) {
                return pattern === text;
            }
            // Eg. "prefix**"
            const len = pattern.length;
            if (len > 2 && pattern.endsWith("**") && firstStarPosition > len - 3) {
                pattern = pattern.substring(0, len - 2);
                return text.startsWith(pattern);
            }
            // Eg. "prefix*"
            if (len > 1 && pattern.endsWith("*") && firstStarPosition > len - 2) {
                pattern = pattern.substring(0, len - 1);
                if (text.startsWith(pattern)) {
                    return text.indexOf(".", len) == -1;
                }
                return false;
            }
            // Accept simple text, without point character (*)
            if (len == 1 && firstStarPosition == 0) {
                return text.indexOf(".") == -1;
            }
            // Accept all inputs (**)
            if (len == 2 && firstStarPosition == 0 && pattern.lastIndexOf("*") == 1) {
                return true;
            }
        }
        // Regex (eg. "prefix.ab?cd.*.foo")
        const origPattern = pattern;
        let regex = this.#RegexCache.get(origPattern);
        if (regex == null) {
            if (pattern.startsWith("$")) {
                pattern = "\\" + pattern;
            }
            pattern = pattern.replace(/\?/g, ".");
            pattern = pattern.replace(/\*\*/g, "§§§");
            pattern = pattern.replace(/\*/g, "[^\\.]*");
            pattern = pattern.replace(/§§§/g, ".*");

            pattern = "^" + pattern + "$";

            regex = new RegExp(pattern, "");
            this.#RegexCache.set(origPattern, regex);
        }
        return regex.test(text);
    }

    add(events: {
        [key: string]: {
            group?: string;
            unbalanced?: boolean;
            handler: (data: any) => Promise<void>;
            passFullEvent?: boolean;
            schema?: ValidationSchema;
        };
    }) {
        for (const [eventName, { group, unbalanced, handler, schema: dataSchema, passFullEvent }] of Object.entries(
            events
        )) {
            const [topicName] = eventName.split(".", 1);
            //TODO: check in list of topics
            //TODO: one handler per event type
            const topic = `${BASE_REDIS_PREFIX}${topicName}`;
            const fullEventName = `com.cryptuoso.${eventName}`;
            if (typeof handler !== "function") throw new Error(`Event handler for ${fullEventName} must be a function`);
            const schema = dataSchema
                ? { ...CLOUD_EVENTS_SCHEMA, data: { type: "object", props: dataSchema } }
                : CLOUD_EVENTS_SCHEMA;

            if (unbalanced) {
                if (!this.#unbalanced[topic])
                    this.#unbalanced[topic] = {
                        subs: {}
                    };
                if (this.#unbalanced[topic].subs[fullEventName])
                    throw new Error(`Event handler for unbalanced ${fullEventName} already registered`);

                this.#unbalanced[topic].subs[fullEventName] = {
                    passFullEvent: passFullEvent || false,
                    handler,
                    validate: this.#v.compile(schema)
                };
            } else {
                if (!this.#grouped[topic]) this.#grouped[topic] = {};
                const groupName = group || process.env.SERVICE;
                if (!this.#grouped[topic][groupName])
                    this.#grouped[topic][groupName] = {
                        subs: {}
                    };
                if (this.#grouped[topic][groupName].subs[fullEventName])
                    throw new Error(`Event handler for ${fullEventName} and group ${groupName} already registered`);
                this.#grouped[topic][groupName].subs[fullEventName] = {
                    passFullEvent: passFullEvent || false,
                    handler,
                    validate: this.#v.compile(schema)
                };
            }
        }
    }

    get grouped() {
        return this.#grouped;
    }

    get unbalanced() {
        return this.#unbalanced;
    }

    get groups(): { topic: string; group: string }[] {
        return flattenArray(
            Object.entries(this.#grouped).map(([topic, groups]) =>
                Object.keys(groups).map((group) => ({
                    topic,
                    group
                }))
            )
        );
    }

    get unbalancedTopics(): string[] {
        return Object.keys(this.#unbalanced);
    }

    getGroupHandlers(topic: string, group: string, type: string) {
        return Object.entries(this.#grouped[topic][group].subs)
            .filter(([eventName]) => this._match(type, eventName))
            .map(([, handlers]) => handlers);
    }

    getUnbalancedHandlers(topic: string, type: string) {
        return Object.entries(this.#unbalanced[topic].subs)
            .filter(([eventName]) => this._match(type, eventName))
            .map(([, handlers]) => handlers);
    }
}
