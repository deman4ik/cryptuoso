import { Queue } from "bullmq";
import { v4 as uuid } from "uuid";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { getValidDate } from "@cryptuoso/helpers";
import { Importer, Status, ImporterParams } from "@cryptuoso/importer-state";
import {
    ImporterRunnerSchema,
    InImporterRunnerEvents,
    ImporterRunnerStart,
    ImporterRunnerStop,
    InImporterWorkerEvents,
    ImporterWorkerPause
} from "@cryptuoso/importer-events";

export type ImporterRunnerServiceConfig = HTTPServiceConfig;

export default class ImporterRunnerService extends HTTPService {
    queues: { [key: string]: Queue<any> };
    constructor(config?: ImporterRunnerServiceConfig) {
        super(config);
        try {
            this.createRoutes([
                {
                    name: "importerStart",
                    inputSchema: ImporterRunnerSchema[InImporterRunnerEvents.START],
                    auth: true,
                    roles: ["admin"],
                    handler: this.startHTTPHandler
                },
                {
                    name: "importerStop",
                    inputSchema: ImporterRunnerSchema[InImporterRunnerEvents.STOP],
                    auth: true,
                    roles: ["admin"],
                    handler: this.stopHTTPHandler
                }
            ]);
            this.events.subscribe({
                [InImporterRunnerEvents.START]: {
                    handler: this.start.bind(this),
                    schema: ImporterRunnerSchema[InImporterRunnerEvents.START]
                },
                [InImporterRunnerEvents.STOP]: {
                    handler: this.stop.bind(this),
                    schema: ImporterRunnerSchema[InImporterRunnerEvents.STOP]
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
            const [{ loadFrom }] = await this.sql`
            select load_from from markets 
            where exchange = ${exchange} 
            and asset = ${asset} and currency = ${currency}
            `;
            const params: ImporterParams = {
                timeframes
            };
            if (type === "history") {
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
            return { id: importer.id, status: importer.status };
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
        const result = await this.stop(req.body.input);
        res.send(result);
        res.end();
    }

    async stop({ id }: ImporterRunnerStop) {
        try {
            const job = await this.queues.importCandles.getJob(id);
            const result = { id, status: Status.canceled };
            if (job) {
                if (job.isActive) {
                    await this.events.emit<ImporterWorkerPause>(InImporterWorkerEvents.PAUSE, {
                        id
                    });
                    result.status = Status.stopping;
                } else {
                    await job.remove();
                }
            }
            return result;
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }
}
