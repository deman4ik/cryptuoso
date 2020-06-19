import dayjs from "@cryptuoso/dayjs";
import {
    chunkDates,
    getValidDate,
    Timeframe,
    ValidTimeframe,
    loadLimit,
    convertExchangeTimeframes,
    sortDesc,
    round,
    CANDLES_RECENT_AMOUNT
} from "@cryptuoso/helpers";

export type ImportType = "recent" | "history";

export const enum Status {
    queued = "queued",
    started = "started",
    finished = "finished",
    failed = "failed",
    stopping = "stopping",
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
    _id: string;
    _exchange: string;
    _asset: string;
    _currency: string;
    _type: ImportType;
    _params: ImporterParams;
    _status: Status;
    _currentState?: {
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
    _progress?: number;
    _startedAt?: string;
    _endedAt?: string;
    _error?: string;

    constructor(state: ImporterState) {
        this._id = state.id;
        this._exchange = state.exchange;
        this._asset = state.asset;
        this._currency = state.currency;
        this._type = state.type;
        this._params = state.params;
        this._status = state.status;
        this._currentState = state.currentState || {};
        this._progress = state.progress || 0;
        this._startedAt = state.startedAt;
        this._endedAt = state.endedAt;
        this._error = state.error;
    }

    _init() {
        if (this._type === "history") {
            if (this._exchange === "kraken") {
                const dateFrom = dayjs.utc(this._params.dateFrom).startOf("day").toISOString();
                const dateTo = getValidDate(this._params.dateTo);
                this._currentState.trades = {
                    dateFrom,
                    dateTo,
                    loaded: false,
                    chunks: []
                };
            } else {
                this._currentState.candles = {};
                this._params.timeframes.sort(sortDesc).forEach((timeframe) => {
                    const { unit, amountInUnit } = Timeframe.get(timeframe);
                    const dateFrom = Timeframe.validTimeframeDateNext(this._params.dateFrom, timeframe);
                    const newDateTo = dayjs.utc(
                        Timeframe.validTimeframeDatePrev(getValidDate(this._params.dateTo, unit), timeframe)
                    );
                    const currentDateTo = dayjs
                        .utc(Timeframe.validTimeframeDatePrev(dayjs.utc().startOf(unit).toISOString(), timeframe))
                        .add(-amountInUnit, unit);

                    const dateTo =
                        newDateTo.valueOf() > currentDateTo.valueOf()
                            ? currentDateTo.toISOString()
                            : newDateTo.toISOString();
                    this._currentState.candles[timeframe] = {
                        timeframe,
                        dateFrom,
                        dateTo,
                        loaded: false,
                        chunks: []
                    };
                });
            }
        } else if (this._type === "recent") {
            const amount = this._params.amount || CANDLES_RECENT_AMOUNT;
            this._currentState.candles = {};
            this._params.timeframes.sort(sortDesc).forEach((timeframe) => {
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

                this._currentState.candles[timeframe] = {
                    timeframe,
                    dateFrom,
                    dateTo,
                    loaded: false,
                    chunks: []
                };
            });
        }
    }

    get init() {
        return this._init;
    }

    _createChunks(timeframes: { [key: string]: string | number }) {
        const exchangeTimeframes = convertExchangeTimeframes(timeframes);
        if (this._type === "history" && this._exchange === "kraken") {
            if (!this._currentState.trades.loaded && this._currentState.trades.chunks.length === 0) {
                const { dateFrom, dateTo } = this._currentState.trades;
                this._currentState.trades.chunks = chunkDates(dateFrom, dateTo, "day", 1, 1).chunks.map(
                    (chunk, index) => ({
                        ...chunk,
                        loaded: false,
                        id: index
                    })
                );
            }
        } else {
            Object.values(this._currentState.candles)
                .filter((s) => s.loaded === false && s.chunks.length === 0)
                .forEach((s) => {
                    let limit = loadLimit(this._exchange);
                    const exchangeHasTimeframe = Timeframe.inList(exchangeTimeframes, Timeframe.toString(s.timeframe));
                    if (!exchangeHasTimeframe) {
                        const lowerTimeframe = Object.values(exchangeTimeframes)
                            .map((t) => +t)
                            .sort(sortDesc)
                            .filter((t) => +t < +s.timeframe)[0];
                        limit = round(loadLimit(this._exchange) / (s.timeframe / lowerTimeframe));
                    }
                    this._currentState.candles[s.timeframe].chunks = Timeframe.chunkDates(
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
    }

    get createChunks() {
        return this._createChunks;
    }

    get id() {
        return this._id;
    }

    get exchange() {
        return this._exchange;
    }

    get asset() {
        return this._asset;
    }

    get currency() {
        return this._currency;
    }

    get type() {
        return this._type;
    }

    get status() {
        return this._status;
    }

    get isStarted() {
        return this._status === "started";
    }

    get params() {
        return this._params;
    }

    get currentState() {
        return this._currentState;
    }

    get state(): ImporterState {
        return {
            id: this._id,
            exchange: this._exchange,
            asset: this._asset,
            currency: this._currency,
            type: this._type,
            params: this._params,
            status: this._status,
            currentState: this._currentState,
            progress: this._progress,
            startedAt: this._startedAt,
            endedAt: this._endedAt,
            error: this._error
        };
    }

    get tradesChunks() {
        if (this._currentState.trades.loaded) return [];
        return this._currentState.trades.chunks.filter((c) => c.loaded === false);
    }

    get candlesChunks() {
        return Object.values(this._currentState.candles)
            .filter((t) => t.loaded === false)
            .map((t) => t.chunks)
            .flat();
    }

    _calcTradesProgress() {
        const loaded = this._currentState.trades.chunks.filter((t) => t.loaded === true).length;
        this._progress = round((loaded / this._currentState.trades.chunks.length) * 100);
    }

    _calcCandlesProgress() {
        const loaded = Object.values(this._currentState.candles)
            .filter((t) => t.loaded === false)
            .map((t) => t.chunks)
            .flat().length;
        this._progress = round(
            (loaded /
                Object.values(this._currentState.candles)
                    .map((t) => t.chunks)
                    .flat().length) *
                100
        );
    }

    _setTradesProgress(chunkId: number) {
        const index = this._currentState.trades.chunks.findIndex(({ id }) => id === chunkId);
        this._currentState.trades.chunks[index].loaded = true;
        this._calcTradesProgress();
        if (this._currentState.trades.chunks.filter((t) => t.loaded === false).length === 0) {
            this._currentState.trades.loaded = true;
        }
        return this._progress;
    }

    get setTradesProgress() {
        return this._setTradesProgress;
    }

    _setCandlesProgress(timeframe: ValidTimeframe, chunkId: number) {
        const index = this._currentState.candles[timeframe].chunks.findIndex(({ id }) => id === chunkId);
        this._currentState.candles[timeframe].chunks[index].loaded = true;
        this._calcCandlesProgress();
        if (this._currentState.candles[timeframe].chunks.filter((t) => t.loaded === false).length === 0) {
            this._currentState.candles[timeframe].loaded = true;
        }
        return this._progress;
    }

    get setCandlesProgress() {
        return this._setCandlesProgress;
    }

    get isLoaded() {
        if (this._currentState.trades) {
            return this._currentState.trades.loaded;
        } else if (this._currentState.candles) {
            return Object.values(this._currentState.candles).filter((t) => t.loaded === false).length === 0;
        }
    }

    get isFailed() {
        return this._status === Status.failed;
    }

    set currentState(state) {
        this._currentState = state;
    }

    set status(status: Status) {
        this._status = status;
    }

    set progress(progress: number) {
        this._progress = progress;
    }

    set startedAt(date: string) {
        this._startedAt = dayjs.utc(date).toISOString();
    }

    set endedAt(date: string) {
        this._endedAt = dayjs.utc(date).toISOString();
    }

    set error(message: string) {
        this._error = message;
    }

    start() {
        this._status = Status.started;
        this._startedAt = this._startedAt ? this._startedAt : dayjs.utc().toISOString();
    }

    finish() {
        if (this.status === Status.failed) return;
        if (this.isLoaded) {
            this._status = Status.finished;
            this._endedAt = dayjs.utc().toISOString();
        } else {
            this._status = Status.queued;
        }
    }

    fail(error: string) {
        this._status = Status.failed;
        this._error = error;
    }
}
