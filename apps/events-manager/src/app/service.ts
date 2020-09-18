import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
//import { CloudEvent } from "cloudevents";
import { eventsManagementConfig, BASE_REDIS_PREFIX, DEAD_LETTER_TOPIC, DeadLetter, Event } from "@cryptuoso/events";
//import { BASE_REDIS_PREFIX } from "../../../../libs/events/src/lib/catalog";

//const BASE_REDIS_PREFIX = "cpz:events:";
//const DEAD_LETTER_TOPIC = "test-events-e2e-dead-letter";
const TEST_TOPIC = "test_topic";

interface StoredDeadLetter {
    id: string;
    eventId: string;
    topic: string;
    type: string;
    data: Event;
    timestamp: string;
    resend: boolean;
    processed: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface EventsManagerConfig extends HTTPServiceConfig {
    /** in seconds */
    checkInterval: number;
}

export default class EventsManager extends HTTPService {
    /** in milliseconds */
    checkInterval: number;

    constructor(config?: EventsManagerConfig) {
        super(config);

        this.checkInterval = 1e3 * (config?.checkInterval || +process.env.CHECK_INTERVAL || 10);

        this.addOnStartHandler(this._onServiceStart);
        this.addOnStopHandler(this._onServiceStop);
    }

    async _onServiceStart() {
        this.events.subscribe({
            [`${DEAD_LETTER_TOPIC}.*`]: {
                /* passFullEvent: true, */
                handler: this._deadLettersHandler.bind(this)
            } /*  as any */,
            [TEST_TOPIC]: {
                handler: this._testHandler.bind(this)
            }
        });

        // TODO: subscribe on route

        this._update();
    }

    async _onServiceStop() {
        
    }

    async _deleteExpiresEvents(
        stream: string,
        cacheTime: number
    ) {
        const threshold = (Date.now() - cacheTime).toString();
        let prevId = "-";

        while(true) {
            const ids = (await this.redis.xrange(
                stream,
                prevId, threshold,
                "COUNT", 100
            )).map((raw) => raw[0]);

            const expiresIds = ids.filter((id) => id < threshold);

            if(expiresIds.length == 0) break;
        
            await this.redis.xdel(stream, ...expiresIds);

            if(expiresIds.length < ids.length) break;

            prevId = ids[ids.length - 1]
        }
    }
    
    async _clearStreams() {
        for(const { topics } of eventsManagementConfig) {
            for(const topic of topics) {
                await this._deleteExpiresEvents(topic.fullname, 1e3 * topic.cacheTime);
            }
        }
    }

    async _updateProcessedDeadLetters(ids: string[]) {
        if(!ids.length) return;

        await this.db.pg.any(this.db.sql`
            UPDATE dead_letters
            SET processed = true
            WHERE id IN (${this.db.sql.join(ids, this.db.sql`, `)});
        `);
    }

    async _checkStoredDeadLetters({
        eventId, topic, type, resend
    }: {
        eventId?: string;
        topic?: string;
        type?: string;
        resend?: boolean;
    }) {
        this.log.info("DB Cheking");

        const conditionEventId = eventId ? this.db.sql`AND event_id = ${eventId}` : this.db.sql``;
        const conditionTopic = topic ? this.db.sql`AND topic = ${topic}` : this.db.sql``;
        const conditionType = type ? this.db.sql`AND "type" = ${type}` : this.db.sql``;
        const conditionResend = typeof resend == "boolean" ? this.db.sql`AND resend = ${resend}` : this.db.sql``;

        const deadLetters: StoredDeadLetter[] = await this.db.pg.any(this.db.sql`
            SELECT *
            FROM dead_letters
            WHERE processed = false
                ${conditionEventId}
                ${conditionTopic}
                ${conditionType}
                ${conditionResend};
        `);
        
        if(!deadLetters?.length) return;

        // TODO: resolve problem of wrong event id

        for(const event of deadLetters) {
            await this.redis.xadd(
                event.topic,
                '*',
                "id", event.id,
                "type", event.type,
                "timestamp", event.timestamp,
                "event", JSON.stringify(event.data)
            )
        }

        await this._updateProcessedDeadLetters(deadLetters.map((dl) => dl.id));

        //await this._testSender();
    }

    async _update() {
        if(this.lightship.isServerShuttingDown()) return;

        const startTime = Date.now();

        try {
            await this._checkStoredDeadLetters({ resend: true });

            // TODO: think about possibility of deleting dead letters before handling

            await this._clearStreams();
        } catch(err) {
            this.log.error(err);
        }

        
        setTimeout(this._update.bind(this), this.checkInterval - (Date.now() - startTime));
    }

    async _deadLettersHandler(deadLetter: DeadLetter) {
        console.warn("Dead Letter");
        console.log(deadLetter);

        const msgIds: string[] = deadLetter.data.map((info: any) => info.msgId);

        const tuples: [string, string, string, string, string][] = [];

        for (const msgId of msgIds) {
            /* const [{ data }] = this.events._parseMessageResponse(
                await this.redis.xrange(deadLetter.topic, msgId, msgId)
            ); */
            const [[_, rawData]] = await this.redis.xrange(deadLetter.topic, msgId, msgId);

            tuples.push([
                rawData[1],         // eventId
                deadLetter.topic,   // topic
                rawData[3],         // type
                rawData[5],         // timestamp
                rawData[7]          // event JSON
            ]);

            /* await this.redis.xdel(
                `${BASE_REDIS_PREFIX}${DEAD_LETTER_TOPIC}`,
                deadLetterMsgId
            ); */
        }

        this.db.pg.query(this.db.sql`
            INSERT INTO dead_letters(
                event_id, topic, "type", "timestamp", data
            )
            SELECT * FROM ${this.db.sql.unnest(
                tuples,
                [
                    "uuid",         // eventId
                    "varchar",      // topic
                    "varchar",      // type
                    `timestamp`,    // timestamp
                    "jsonb"         // event JSON
                ]
            )};
        `);
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
