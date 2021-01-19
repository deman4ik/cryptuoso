import dayjs from "@cryptuoso/dayjs";
import { chunkDates, getValidDate, sortDesc, round, CANDLES_RECENT_AMOUNT } from "@cryptuoso/helpers";
import { Timeframe, ValidTimeframe, loadLimit, convertExchangeTimeframes } from "@cryptuoso/market";

export type ImportType = "recent" | "history";

export const enum Status {
    queued = "queued",
    started = "started",
    finished = "finished",
    failed = "failed",
    canceled = "canceled"
}

export interface ImporterParams {
    timeframes: number[];
    amount?: number;
    dateFrom?: string;
    dateTo?: string;
}

export interface ImporterState {
    id: string;
    exchange: string;
    asset: string;
    currency: string;
    type: ImportType;
    params: ImporterParams;
    status: Status;
    currentState?: {
        trades?: {
            dateFrom: string;
            dateTo: string;
            loaded: boolean;
            chunks: TradesChunk[];
        };
        candles?: {
            [key: string]: {
                timeframe: ValidTimeframe;
                dateFrom: string;
                dateTo: string;
                loaded: boolean;
                chunks: CandlesChunk[];
            };
        };
    };
    progress?: number;
    startedAt?: string;
    endedAt?: string;
    error?: string;
}

export interface TradesChunk {
    id: number;
    dateFrom: string;
    dateTo: string;
    loaded: boolean;
}

export interface CandlesChunk extends TradesChunk {
    timeframe: ValidTimeframe;
    limit: number;
}

export class Importer {
    #id: string;
    #exchange: string;
    #asset: string;
    #currency: string;
    #type: ImportType;
    #params: ImporterParams;
    #status: Status;
    #currentState?: {
        trades?: {
            dateFrom: string;
            dateTo: string;
            loaded: boolean;
            chunks: TradesChunk[];
        };
        candles?: {
            [key: string]: {
                timeframe: ValidTimeframe;
                dateFrom: string;
                dateTo: string;
                loaded: boolean;
                chunks: CandlesChunk[];
            };
        };
    };
    #progress?: number;
    #startedAt?: string;
    #endedAt?: string;
    #error?: string;

    constructor(state: ImporterState) {
        this.#id = state.id;
        this.#exchange = state.exchange;
        this.#asset = state.asset;
        this.#currency = state.currency;
        this.#type = state.type;
        this.#params = state.params;
        this.#status = state.status;
        this.#currentState = state.currentState || {};
        this.#progress = state.progress || 0;
        this.#startedAt = state.startedAt;
        this.#endedAt = state.endedAt;
        this.#error = state.error;
    }

    #init = () => {
        if (this.#type === "history") {
            if (this.#exchange === "kraken") {
                const dateFrom = dayjs
                    .utc(this.#params.dateFrom)
                    .startOf("day")
                    .toISOString();
                const dateTo = getValidDate(this.#params.dateTo);
                this.#currentState.trades = {
                    dateFrom,
                    dateTo,
                    loaded: false,
                    chunks: []
                };
            } else {
                this.#currentState.candles = {};
                this.#params.timeframes.sort(sortDesc).forEach((timeframe) => {
                    const { unit, amountInUnit } = Timeframe.get(timeframe);
                    const dateFrom = Timeframe.validTimeframeDateNext(this.#params.dateFrom, timeframe);
                    const newDateTo = dayjs.utc(
                        Timeframe.validTimeframeDatePrev(getValidDate(this.#params.dateTo, unit), timeframe)
                    );
                    const currentDateTo = dayjs
                        .utc(Timeframe.validTimeframeDatePrev(dayjs.utc().startOf(unit).toISOString(), timeframe))
                        .add(-amountInUnit, unit);

                    const dateTo =
                        newDateTo.valueOf() > currentDateTo.valueOf()
                            ? currentDateTo.toISOString()
                            : newDateTo.toISOString();
                    this.#currentState.candles[timeframe] = {
                        timeframe,
                        dateFrom,
                        dateTo,
                        loaded: false,
                        chunks: []
                    };
                });
            }
        } else if (this.#type === "recent") {
            const amount = this.#params.amount || CANDLES_RECENT_AMOUNT;
            this.#currentState.candles = {};
            this.#params.timeframes.sort(sortDesc).forEach((timeframe) => {
                const { unit, amountInUnit } = Timeframe.get(timeframe);
                const dateTo = Timeframe.validTimeframeDatePrev(
                    dayjs.utc().startOf(unit).add(-amountInUnit, unit).toISOString(),
                    timeframe
                );

                const dateFrom = Timeframe.validTimeframeDatePrev(
                    dayjs
                        .utc(dateTo)
                        .add(-amountInUnit * amount, unit)
                        .startOf(unit)
                        .toISOString(),
                    timeframe
                );

                this.#currentState.candles[timeframe] = {
                    timeframe,
                    dateFrom,
                    dateTo,
                    loaded: false,
                    chunks: []
                };
            });
        }
    };

    get init() {
        return this.#init;
    }

    #createChunks = (timeframes: { [key: string]: string | number }) => {
        const exchangeTimeframes = convertExchangeTimeframes(timeframes);
        if (this.#type === "history" && this.#exchange === "kraken") {
            if (!this.#currentState.trades.loaded && this.#currentState.trades.chunks.length === 0) {
                const { dateFrom, dateTo } = this.#currentState.trades;
                this.#currentState.trades.chunks = chunkDates(dateFrom, dateTo, "day", 1, 1).chunks.map(
                    (chunk, index) => ({
                        ...chunk,
                        loaded: false,
                        id: index
                    })
                );
            }
        } else {
            Object.values(this.#currentState.candles)
                .filter(
                    (s) =>
                        ((this.#type === "history" && s.loaded === false) || this.#type === "recent") &&
                        s.chunks.length === 0
                )
                .forEach((s) => {
                    let limit = loadLimit(this.#exchange);
                    const exchangeHasTimeframe = Timeframe.inList(exchangeTimeframes, Timeframe.toString(s.timeframe));
                    if (!exchangeHasTimeframe) {
                        const lowerTimeframe = Object.values(exchangeTimeframes)
                            .map((t) => +t)
                            .sort(sortDesc)
                            .filter((t) => +t < +s.timeframe)[0];
                        limit = round(loadLimit(this.#exchange) / (s.timeframe / lowerTimeframe));
                    }
                    this.#currentState.candles[s.timeframe].loaded = false;
                    this.#currentState.candles[s.timeframe].chunks = Timeframe.chunkDates(
                        s.dateFrom,
                        s.dateTo,
                        s.timeframe,
                        limit
                    ).chunks.map((chunk, index) => ({
                        ...chunk,
                        timeframe: s.timeframe,
                        limit,
                        loaded: false,
                        id: +`${s.timeframe}${index}`
                    }));
                });
        }
    };

    get createChunks() {
        return this.#createChunks;
    }

    get id() {
        return this.#id;
    }

    get exchange() {
        return this.#exchange;
    }

    get asset() {
        return this.#asset;
    }

    get currency() {
        return this.#currency;
    }

    get type() {
        return this.#type;
    }

    get status() {
        return this.#status;
    }

    set status(status: Status) {
        this.#status = status;
    }

    get isStarted() {
        return this.#status === Status.started;
    }

    get params() {
        return this.#params;
    }

    get currentState() {
        return this.#currentState;
    }

    set currentState(state) {
        this.#currentState = state;
    }

    get state(): ImporterState {
        return {
            id: this.#id,
            exchange: this.#exchange,
            asset: this.#asset,
            currency: this.#currency,
            type: this.#type,
            params: this.#params,
            status: this.#status,
            currentState: this.#currentState,
            progress: this.#progress,
            startedAt: this.#startedAt,
            endedAt: this.#endedAt,
            error: this.#error
        };
    }

    get tradesChunks() {
        if (this.#currentState.trades.loaded) return [];
        return this.#currentState.trades.chunks.filter((c) => c.loaded === false);
    }

    get candlesChunks() {
        return Object.values(this.#currentState.candles)
            .filter((t) => t.loaded === false)
            .map((t) => t.chunks)
            .flat();
    }

    #calcTradesProgress = () => {
        const loaded = this.#currentState.trades.chunks.filter((t) => t.loaded === true).length;
        const prevProgress = this.#progress;
        this.#progress = round((loaded / this.#currentState.trades.chunks.length) * 100);
        return prevProgress !== this.#progress;
    };

    #calcCandlesProgress = () => {
        const loaded = Object.values(this.#currentState.candles)
            .filter((t) => t.loaded === true)
            .map((t) => t.chunks)
            .flat().length;
        const prevProgress = this.#progress;
        this.#progress = round(
            (loaded /
                Object.values(this.#currentState.candles)
                    .map((t) => t.chunks)
                    .flat().length) *
                100
        );
        return prevProgress !== this.#progress;
    };

    #setTradesProgress = (chunkId: number) => {
        const index = this.#currentState.trades.chunks.findIndex(({ id }) => id === chunkId);
        this.#currentState.trades.chunks[index].loaded = true;
        if (this.#currentState.trades.chunks.filter((t) => t.loaded === false).length === 0) {
            this.#currentState.trades.loaded = true;
        }
        const progressChanged = this.#calcTradesProgress();
        this.finish();
        return progressChanged;
    };

    get setTradesProgress() {
        return this.#setTradesProgress;
    }

    #setCandlesProgress = (timeframe: ValidTimeframe, chunkId: number) => {
        const index = this.#currentState.candles[timeframe].chunks.findIndex(({ id }) => id === chunkId);
        this.#currentState.candles[timeframe].chunks[index].loaded = true;
        if (this.#currentState.candles[timeframe].chunks.filter((t) => t.loaded === false).length === 0) {
            this.#currentState.candles[timeframe].loaded = true;
        }
        const progressChanged = this.#calcCandlesProgress();
        this.finish();
        return progressChanged;
    };

    get setCandlesProgress() {
        return this.#setCandlesProgress;
    }

    get isLoaded() {
        if (this.#currentState.trades) {
            return this.#currentState.trades.loaded;
        } else if (this.#currentState.candles) {
            return Object.values(this.#currentState.candles).filter((t) => t.loaded === false).length === 0;
        } else return false;
    }

    get isFailed() {
        return this.#status === Status.failed;
    }

    get isFinished() {
        return this.#status === Status.finished || this.#status === Status.canceled;
    }

    get error() {
        return this.#error;
    }

    set error(message: string) {
        this.#error = message;
    }

    get progress() {
        return this.#progress;
    }

    set progress(progress: number) {
        this.#progress = progress;
    }

    set startedAt(date: string) {
        this.#startedAt = dayjs.utc(date).toISOString();
    }

    set endedAt(date: string) {
        this.#endedAt = dayjs.utc(date).toISOString();
    }

    start() {
        this.#status = Status.started;
        this.#startedAt = this.#startedAt ? this.#startedAt : dayjs.utc().toISOString();
    }

    finish(cancel = false) {
        this.#endedAt = dayjs.utc().toISOString();
        if (this.status === Status.failed) return;
        if (cancel) {
            this.#status = Status.canceled;
            return;
        }
        if (this.isLoaded) {
            this.#status = Status.finished;
        }
    }

    fail(error: string) {
        this.#status = Status.failed;
        this.#error = error;
    }
}
