import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { CloudEvent } from 'cloudevents';
import { BASE_REDIS_PREFIX } from '../../../../libs/events/src/lib/catalog';

const DEAD_LETTER_TOPIC = "test-events-e2e-dead-letter";
const TEST_TOPIC = "test_topic";

export type EventsManagerConfig = BaseServiceConfig;

export default class EventsManager extends BaseService {
    constructor(config?: EventsManagerConfig) {
        super({
            ...config,
            eventsConfig: {
                deadLetterTopic: DEAD_LETTER_TOPIC
            }
        });

        this.addOnStartHandler(this._onServiceStart);
    }

    async _onServiceStart() {
        this.events.subscribe({
            [`${DEAD_LETTER_TOPIC}.*`]: {
                handler: this._deadLetterHandler.bind(this)
            },
            [TEST_TOPIC]: {
                handler: this._testHandler.bind(this)
            }
        });

        setTimeout(async () => {
            /* await this.events.emit({
                type: TEST_TOPIC,
                data: { foo: "bar" }
            }); */

            const deadLetters = await this.redis.xread("COUNT", 100, "STREAMS", `${BASE_REDIS_PREFIX}${DEAD_LETTER_TOPIC}`, "0");
            
            console.warn(JSON.stringify(deadLetters, null, 3));
        }, 5e3);
    }

    async _deadLetterHandler(event: CloudEvent) {
        console.warn("Dead Letter");
        console.log(event);
    }
    
    async _testHandler(event: CloudEvent) {
        console.log(event);
        throw new Error("Test error");
    }
}