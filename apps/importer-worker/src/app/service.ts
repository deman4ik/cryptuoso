import { spawn, Worker as ThreadsWorker, Thread, Pool } from "threads";
import { Job } from "bullmq";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { Importer, ImporterParams, ImporterState, Status } from "@cryptuoso/importer-state";
import { BaseError } from "@cryptuoso/errors";
import {
    ImporterRunnerSchema,
    ImporterRunnerEvents,
    ImporterRunnerStart,
    ImporterRunnerStop,
    ImporterWorkerFailed,
    ImporterWorkerFinished,
    ImporterWorkerCancel,
    ImporterWorkerSchema,
    ImporterWorkerEvents
} from "@cryptuoso/importer-events";
import { getExwatcherImporterStatusEventName } from "@cryptuoso/exwatcher-events";
import { sql } from "@cryptuoso/postgres";
import { UserRoles } from "@cryptuoso/user-state";
import { ImportWorker } from "./worker";
import { CANDLES_RECENT_AMOUNT, getValidDate } from "@cryptuoso/helpers";
import { v4 as uuid } from "uuid";
import dayjs from "@cryptuoso/dayjs";

export type ImporterWorkerServiceConfig = HTTPServiceConfig;

export default class ImporterWorkerService extends HTTPService {
    #pool: Pool<any>;
    abort: { [key: string]: boolean } = {};
    constructor(config?: ImporterWorkerServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                importerStart: {
                    inputSchema: ImporterRunnerSchema[ImporterRunnerEvents.START],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.start.bind(this))
                },
                importerStop: {
                    inputSchema: ImporterRunnerSchema[ImporterRunnerEvents.STOP],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.stop.bind(this))
                },
                importerStartAllMarkets: {
                    inputSchema: {
                        exchange: "string"
                    },
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.startAllMarkets.bind(this))
                }
            });
            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error("Error in ImporterWorkerService constructor", err);
        }
    }

    async onServiceStart(): Promise<void> {
        this.#pool = await Pool(
            async () => await spawn<ImportWorker>(new ThreadsWorker("./worker"), { timeout: 60000 }),
            {
                name: "worker",
                concurrency: this.workerConcurrency,
                size: this.workerThreads
            }
        );
        this.events.subscribe({
            [ImporterRunnerEvents.START]: {
                handler: this.start.bind(this),
                schema: ImporterRunnerSchema[ImporterRunnerEvents.START]
            },
            [ImporterRunnerEvents.STOP]: {
                handler: this.stop.bind(this),
                schema: ImporterRunnerSchema[ImporterRunnerEvents.STOP]
            },
            [ImporterWorkerEvents.CANCEL]: {
                handler: this.cancel.bind(this),
                schema: ImporterWorkerSchema[ImporterWorkerEvents.CANCEL],
                unbalanced: true
            }
        });
        this.createQueue("importCandles");
        this.queues["importCandles"].events.on("failed", async ({ jobId, failedReason }) => {
            try {
                await this.db.pg.query(sql`
                    UPDATE importers SET 
                        error = ${failedReason || "unknown"}, 
                        status = ${"failed"}
                        WHERE ID = ${jobId};`);
            } catch (err) {
                this.log.error("Failed to update importer error", err);
            }
        });
        this.createWorker("importCandles", this.process);
    }

    async start({ id, exchange, asset, currency, type, timeframes, dateFrom, dateTo, amount }: ImporterRunnerStart) {
        try {
            const params: ImporterParams = {
                timeframes:
                    timeframes || type === "history"
                        ? [1440, 720, 480, 240, 120, 60, 30]
                        : [1440, 720, 480, 240, 120, 60, 30, 15, 5]
            };
            const market = await this.db.pg.maybeOne<{ loadFrom: string }>(sql`
            select load_from from markets 
            where exchange = ${exchange} 
            and asset = ${asset} and currency = ${currency}
            `);
            if (!market)
                throw new BaseError(
                    `Market ${exchange} ${asset}/${currency} doesn't exists.`,
                    { exchange, asset, currency },
                    "NotFound"
                );
            if (type === "history") {
                params.dateFrom = dateFrom ? getValidDate(dateFrom) : market.loadFrom;
                params.dateTo = dateTo ? getValidDate(dateTo) : dayjs.utc().startOf("minute").toISOString();
            } else {
                params.amount = amount || CANDLES_RECENT_AMOUNT;
            }

            const importer = new Importer({
                id: id || uuid(),
                exchange,
                asset,
                currency,
                type,
                params,
                status: Status.queued
            });
            importer.init();
            this.log.debug("Starting", { id, exchange, asset, currency, type, timeframes, dateFrom, dateTo, amount });
            await this.addJob("importCandles", importer.type, importer.state, {
                jobId: importer.id,
                removeOnComplete: true,
                removeOnFail: 100
            });
            return { result: importer.id };
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }

    async stop({ id }: ImporterRunnerStop) {
        try {
            const job = await this.queues["importCandles"].instance.getJob(id);
            if (job) {
                if (job.isActive) {
                    await this.events.emit<ImporterWorkerCancel>({
                        type: ImporterWorkerEvents.CANCEL,
                        data: {
                            id
                        }
                    });
                } else {
                    await job.remove();
                }
            }
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }

    async startAllMarkets({ exchange }: { exchange: string }) {
        try {
            const markets = await this.db.pg.any<{ exchange: string; asset: string; currency: string }>(
                sql`SELECT exchange, asset, currency FROM markets where available >= 10 and exchange = ${exchange};`
            );
            for (const market of markets) {
                await this.start({ ...market, type: "history", timeframes: [1440, 720, 480, 240, 120, 60, 30] });
            }
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }

    cancel({ id }: ImporterWorkerCancel): void {
        this.abort[id] = true;
    }

    async saveState(state: ImporterState) {
        const {
            id,
            exchange,
            asset,
            currency,
            params,
            status,
            startedAt,
            endedAt,
            type,
            progress,
            error,
            currentState
        } = state;
        await this.db.pg.query(sql`
        INSERT INTO importers
        (id, exchange, asset, currency, 
        params, 
        status, started_at, ended_at, 
        type, progress, error,
        current_state)
        VALUES(
            ${id}, ${exchange}, ${asset}, ${currency},
            ${JSON.stringify(params) || null},
            ${status}, ${startedAt || null}, ${endedAt || null},
            ${type}, ${progress || null}, ${error || null}, 
            ${JSON.stringify(currentState) || null}
        )
        ON CONFLICT ON CONSTRAINT importers_pkey
        DO UPDATE SET params = excluded.params,
        status = excluded.status,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        progress = excluded.progress,
        error = excluded.error,
        current_state = excluded.current_state;
        `);
    }

    async importerWorker(robotState: ImporterState): Promise<ImporterState> {
        return await this.#pool.queue(async (worker: ImportWorker) => worker.process(robotState));
    }

    async process(job: Job<ImporterState, Status>): Promise<Status> {
        try {
            this.log.info(`Processing job ${job.id}`);
            const beacon = this.lightship.createBeacon();
            try {
                let importer = new Importer(job.data);

                importer.start();

                const finalState = await this.importerWorker(importer.state);
                importer = new Importer(finalState);

                await this.saveState(importer.state);
                job.update(importer.state);
                if (importer.isFailed) {
                    await this.events.emit<ImporterWorkerFailed>({
                        type: ImporterWorkerEvents.FAILED,
                        data: {
                            id: importer.id,
                            type: importer.type,
                            exchange: importer.exchange,
                            asset: importer.asset,
                            currency: importer.currency,
                            status: Status.failed,
                            error: importer.error
                        }
                    });
                    if (importer.type === "recent") {
                        await this.events.emit<ImporterWorkerFailed>({
                            type: getExwatcherImporterStatusEventName(importer.exchange),
                            data: {
                                id: importer.id,
                                type: importer.type,
                                exchange: importer.exchange,
                                asset: importer.asset,
                                currency: importer.currency,
                                status: Status.failed,
                                error: importer.error
                            }
                        });
                    }
                    throw new BaseError(importer.error, { importerId: importer.id });
                }
                if (importer.isFinished)
                    await this.events.emit<ImporterWorkerFinished>({
                        type: ImporterWorkerEvents.FINISHED,
                        data: {
                            id: importer.id,
                            type: importer.type,
                            exchange: importer.exchange,
                            asset: importer.asset,
                            currency: importer.currency,
                            status: Status.finished
                        }
                    });
                if (importer.type === "recent") {
                    await this.events.emit<ImporterWorkerFinished>({
                        type: getExwatcherImporterStatusEventName(importer.exchange),
                        data: {
                            id: importer.id,
                            type: importer.type,
                            exchange: importer.exchange,
                            asset: importer.asset,
                            currency: importer.currency,
                            status: Status.finished
                        }
                    });
                }
                this.log.info(`Job ${job.id} processed - Importer is ${importer.status}!`);
                return importer.status;
            } finally {
                await beacon.die();
            }
        } catch (err) {
            this.log.error(`Error while processing job #${job.id}`, err);
            throw err;
        }
    }
}
