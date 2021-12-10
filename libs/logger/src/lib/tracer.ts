import { logger } from "./logger";
import dayjs from "@cryptuoso/dayjs";
import { v4 as uuid } from "uuid";

export class Tracer {
    #id: string;

    #meta: { [key: string]: any };

    #traces: {
        [key: string]: {
            message: string;
            startedAt: dayjs.Dayjs;
            endedAt?: dayjs.Dayjs;
            duration?: number;
        };
    } = {};
    constructor(meta?: { [key: string]: any }) {
        this.#id = uuid();
        this.#meta = meta;
    }

    start(message: string) {
        const index = Object.keys(this.#traces).length + 1;

        this.#traces[index] = {
            startedAt: dayjs.utc(),
            message
        };

        logger.debug(
            `[TRACE] ${this.#traces[index].message} - [Started ${this.#traces[index].startedAt.toISOString()}]`
        );
        return index;
    }

    end(index: number) {
        this.#traces[index].endedAt = dayjs.utc();
        this.#traces[index].duration = this.#traces[index].endedAt.diff(this.#traces[index].startedAt, "millisecond");
        logger.debug(
            `[TRACE] ${this.#traces[index].message} - [Ended ${this.#traces[
                index
            ].startedAt.toISOString()}] - [Duration ${this.#traces[index].duration} ms]`
        );
    }

    get state() {
        return Object.values(this.#traces).map((t, index) => ({
            tracerId: this.#id,
            meta: this.#meta,
            traceNum: index,
            message: t.message,
            startedAt: t.startedAt.toISOString(),
            endedAt: t.endedAt.toISOString(),
            duration: t.duration
        }));
    }
}
