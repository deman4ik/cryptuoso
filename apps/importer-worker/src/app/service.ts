import { spawn, Worker as ThreadsWorker, Thread } from "threads";
import { Job } from "bullmq";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { PublicConnector } from "@cryptuoso/ccxt-public";
import { Importer, ImporterState } from "@cryptuoso/importer-state";

import { BaseError } from "@cryptuoso/errors";
import {
    ImporterWorkerFailed,
    ImporterWorkerFinished,
    ImporterWorkerCancel,
    ImporterWorkerSchema,
    ImporterWorkerEvents
} from "@cryptuoso/importer-events";
import { sql } from "@cryptuoso/postgres";
import { ImportWorker } from "./worker";

export type ImporterWorkerServiceConfig = BaseServiceConfig;

export default class ImporterWorkerService extends BaseService {
    connector: PublicConnector;
    abort: { [key: string]: boolean } = {};
    constructor(config?: ImporterWorkerServiceConfig) {
        super(config);
        try {
            this.connector = new PublicConnector();
            this.addOnStartHandler(this.onServiceStart);
            this.events.subscribe({
                [ImporterWorkerEvents.CANCEL]: {
                    handler: this.cancel.bind(this),
                    schema: ImporterWorkerSchema[ImporterWorkerEvents.CANCEL],
                    unbalanced: true
                }
            });
        } catch (err) {
            this.log.error("Error in ImporterWorkerService constructor", err);
        }
    }

    async onServiceStart(): Promise<void> {
        this.createWorker("importCandles", this.process);
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

    async process(job: Job<ImporterState, ImporterState>): Promise<ImporterState> {
        try {
            this.log.info(`Processing job ${job.id}`);
            const beacon = this.lightship.createBeacon();
            const importerWorker = await spawn<ImportWorker>(new ThreadsWorker("./worker"));
            this.log.info(`Worker spawned ${job.id}`);
            try {
                let importer = new Importer(job.data);
                if (!importer.isLoaded || importer.type === "recent") {
                    importer.start();
                    importerWorker.progress().subscribe(async (state: ImporterState) => {
                        await job.updateProgress(state.progress);

                        if (this.abort[importer.id]) {
                            importer = new Importer(state);
                            importer.finish(true);
                            await this.saveState(importer.state);
                            delete this.abort[importer.id];
                            throw new Error(`Importer #${importer.id} is canceled`);
                        }
                    });
                }
                const initState = await importerWorker.init(importer.state);
                importer = new Importer(initState);
                const finalState = await importerWorker.process();
                importer = new Importer(finalState);
                this.log.info(`Importer #${importer.id} is ${importer.status}!`);
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
                            error: importer.error
                        }
                    });
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
                            status: importer.status
                        }
                    });

                return importer.state;
            } finally {
                await Thread.terminate(importerWorker);
                await beacon.die();
            }
        } catch (err) {
            this.log.error(`Error while processing job #${job.id}`, err);
            throw err;
        }
    }
}
