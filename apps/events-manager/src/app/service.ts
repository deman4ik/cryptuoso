import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
//import { CloudEvent } from "cloudevents";
import { BASE_REDIS_PREFIX, DEAD_LETTER_TOPIC, DeadLetter, Event } from "@cryptuoso/events";
//import { BASE_REDIS_PREFIX } from "../../../../libs/events/src/lib/catalog";

//const BASE_REDIS_PREFIX = "cpz:events:";
//const DEAD_LETTER_TOPIC = "test-events-e2e-dead-letter";
const TEST_TOPIC = "test_topic";

interface StoredDeadLetter {
    id: string;
    topic: string;
    type: string;
    data: Event;
    timestamp: string;
    resend: boolean;
    processed: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface EventsManagerConfig extends BaseServiceConfig {
    /** in milliseconds */
    checkInterval: number;
}

export default class EventsManager extends BaseService {
    private checkIntervalId: NodeJS.Timer;
    checkInterval: number;

    constructor(config?: EventsManagerConfig) {
        super(config);

        this.checkInterval = 1e3 * (config?.checkInterval || +process.env.CHECK_INTERVAL || 10);

        this.addOnStartHandler(this._onServiceStart);
        this.addOnStopHandler(this._onServiceStop);
    }

    async _onServiceStart() {
        this.checkIntervalId = setInterval(
            this._checkStoredDeadLetters.bind(this),
            this.checkInterval
        );

        this.events.subscribe({
            [`${DEAD_LETTER_TOPIC}.*`]: {
                /* passFullEvent: true, */
                handler: this._deadLetterHandler.bind(this)
            } /*  as any */,
            [TEST_TOPIC]: {
                handler: this._testHandler.bind(this)
            }
        });

        setTimeout(this._testSender.bind(this), 5e3);
    }

    async _onServiceStop() {
        if(this.checkIntervalId)
            clearInterval(this.checkIntervalId);

        this.checkIntervalId = null;
    }

    async _updateProcessedDeadLetters(ids: string[]) {
        if(!ids.length) return;

        await this.db.pg.any(this.db.sql`
            UPDATE dead_letters
            SET processed = true
            WHERE id IN (${this.db.sql.join(ids, this.db.sql`, `)});
        `);
    }

    async _checkStoredDeadLetters() {
        this.log.info("DB Cheking");

        const deadLetters: StoredDeadLetter[] = await this.db.pg.any(this.db.sql`
            SELECT *
            FROM dead_letters
            WHERE resend = true
                AND processed = false;
        `);
        
        if(!deadLetters?.length) return;

        // TODO: ReEmit events

        await this._updateProcessedDeadLetters(deadLetters.map((dl) => dl.id));
    }

    async _storeDeadLetter(params: { id: string; topic: string; type: string; timestamp: string; data: string }) {
        await this.db.pg.query(this.db.sql`
            INSERT INTO dead_letters(
                id, topic, "type", "timestamp", data
            ) VALUES (
                ${params.id},
                ${params.topic},
                ${params.type},
                ${params.timestamp},
                ${params.data}
            )
        `);
    }

    async _deadLetterHandler(deadLetter: DeadLetter) {
        console.warn("Dead Letter");
        console.log(deadLetter);

        const data: {
            msgId: string;
            consumer: string;
            idleSeconds: number;
            retries: number;
        }[] = deadLetter.data;

        for (const { msgId } of data) {
            const [[_, rawData]] = await this.redis.xrange(deadLetter.topic, msgId, msgId);

            await this._storeDeadLetter({
                topic: deadLetter.topic,
                id: rawData[1],
                type: rawData[3],
                timestamp: rawData[5],
                data: rawData[7]
            });

            /* await this.redis.xdel(
                `${BASE_REDIS_PREFIX}${TEST_TOPIC}`,
                "1600345288962-0"
            ); */
        }
    }

    async _testSender() {
        await this.events.emit({
            type: TEST_TOPIC,
            data: { foo: "bar" }
        });
    }

    async _testHandler(data: any) {
        console.log(data);
        throw new Error("Test error");
    }
}
