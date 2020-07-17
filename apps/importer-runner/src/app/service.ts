import { Queue } from "bullmq";
import { v4 as uuid } from "uuid";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { getValidDate } from "@cryptuoso/helpers";
import { Importer, Status, ImporterParams } from "@cryptuoso/importer-state";
import {
    ImporterRunnerSchema,
    ImporterRunnerEvents,
    ImporterRunnerStart,
    ImporterRunnerStop,
    ImporterWorkerEvents,
    ImporterWorkerPause
} from "@cryptuoso/importer-events";

export type ImporterRunnerServiceConfig = HTTPServiceConfig;

export default class ImporterRunnerService extends HTTPService {
    queues: { [key: string]: Queue<any> };
    constructor(config?: ImporterRunnerServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                importerStart: {
                    inputSchema: ImporterRunnerSchema[ImporterRunnerEvents.START],
                    auth: true,
                    roles: ["manager", "admin"],
                    handler: this.startHTTPHandler
                },
                importerStop: {
                    inputSchema: ImporterRunnerSchema[ImporterRunnerEvents.STOP],
                    auth: true,
                    roles: ["manager", "admin"],
                    handler: this.stopHTTPHandler
                }
            });
            this.events.subscribe({
                [ImporterRunnerEvents.START]: {
                    handler: this.start.bind(this),
                    schema: ImporterRunnerSchema[ImporterRunnerEvents.START]
                },
                [ImporterRunnerEvents.STOP]: {
                    handler: this.stop.bind(this),
                    schema: ImporterRunnerSchema[ImporterRunnerEvents.STOP]
                }
            });
            this.addOnStartHandler(this.onStartService);
            this.addOnStopHandler(this.onStopService);
        } catch (err) {
            this.log.error(err, "While consctructing ImporterRunnerService");
        }
    }

    async onStartService() {
        this.queues = {
            importCandles: new Queue("importCandles", { connection: this.redis })
        };
    }

    async onStopService() {
        await this.queues.importCandles.close();
    }

    async startHTTPHandler(
        req: {
            body: {
                input: ImporterRunnerStart;
            };
        },
        res: any
    ) {
        const result = await this.start(req.body.input);
        res.send(result);
        res.end();
    }

    async start({ id, exchange, asset, currency, type, timeframes, dateFrom, dateTo, amount }: ImporterRunnerStart) {
        try {
            const params: ImporterParams = {
                timeframes
            };
            if (type === "history") {
                const { loadFrom } = await this.db.pg.one(this.db.sql`
            select load_from from markets 
            where exchange = ${exchange} 
            and asset = ${asset} and currency = ${currency}
            `);
                params.dateFrom = dateFrom ? getValidDate(dateFrom) : loadFrom;
                params.dateTo = dateTo ? getValidDate(dateTo) : dayjs.utc().startOf("minute").toISOString();
            } else {
                params.amount = amount;
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

            await this.queues.importCandles.add(importer.type, importer.state, {
                jobId: importer.id,
                removeOnComplete: true
            });
            return { result: importer.id };
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }

    async stopHTTPHandler(
        req: {
            body: {
                input: ImporterRunnerStop;
            };
        },
        res: any
    ) {
        await this.stop(req.body.input);
        res.send({ result: "OK" });
        res.end();
    }

    async stop({ id }: ImporterRunnerStop) {
        try {
            const job = await this.queues.importCandles.getJob(id);
            if (job) {
                if (job.isActive) {
                    await this.events.emit<ImporterWorkerPause>(ImporterWorkerEvents.PAUSE, {
                        id
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
}
