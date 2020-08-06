import { ValidationSchema } from "fastest-validator";

export interface GenericObject<T> {
  [key: string]: T;
}

declare namespace cpz {
  const enum Service {
    DB_EXCHANGES = "db-exchanges",
    DB_IMPORTERS = "db-importers",
    DB_CANDLES = "db-candles",
    DB_CANDLES_CURRENT = "db-candles-current",
    DB_EXWATCHERS = "db-exwatchers",
    DB_BACKTESTS = "db-backtests",
    DB_BACKTEST_POSITIONS = "db-backtest-positions",
    DB_BACKTEST_SIGNALS = "db-backtest-signals",
    DB_BACKTEST_LOGS = "db-backtest-logs",
    DB_STRATEGIES = "db-strategies",
    DB_INDICATORS = "db-indicators",
    DB_ROBOTS = "db-robots",
    DB_ROBOT_JOBS = "db-robot-jobs",
    DB_ROBOT_POSITIONS = "db-robot-positions",
    DB_ROBOT_SIGNALS = "db-robot-signals",
    DB_ROBOT_LOGS = "db-robot-logs",
    DB_ROBOT_HISTORY = "db-robot-history",
    DB_USERS = "db-users",
    DB_USER_SIGNALS = "db-user-signals",
    DB_USER_EXCHANGE_ACCS = "db-user-exchange-accs",
    DB_USER_ROBOTS = "db-user-robots",
    DB_USER_ROBOT_JOBS = "db-user-robot-jobs",
    DB_USER_ROBOT_HISTORY = "db-user-robot-history",
    DB_USER_ORDERS = "db-user-orders",
    DB_USER_POSITIONS = "db-user-positions",
    DB_USER_AGGR_STATS = "db-user-aggr-stats",
    DB_CONNECTOR_JOBS = "db-connector-jobs",
    DB_MARKETS = "db-markets",
    DB_MESSAGES = "db-messages",
    DB_NOTIFICATIONS = "db-notifications",
    EXWATCHER = "exwatcher",
    EXWATCHER_RUNNER = "exwatcher-runner",
    IMPORTER_RUNNER = "importer-runner",
    IMPORTER_WORKER = "importer-worker",
    PUBLIC_CONNECTOR = "public-connector",
    PRIVATE_CONNECTOR_RUNNER = "private-connector-runner",
    PRIVATE_CONNECTOR_WORKER = "private-connector-worker",
    ROBOT_RUNNER = "robot-runner",
    ROBOT_WORKER = "robot-worker",
    BACKTESTER_RUNNER = "backtester-runner",
    BACKTESTER_WORKER = "backtester-worker",
    USER_ROBOT_RUNNER = "user-robot-runner",
    USER_ROBOT_WORKER = "user-robot-worker",
    STATS_CALC_RUNNER = "stats-calc-runner",
    STATS_CALC_WORKER = "stats-calc-worker",
    AUTH = "auth",
    API = "api",
    TELEGRAM_BOT = "telegram-bot",
    PUBLISHER = "publisher",
    MAIL = "mail"
  }

  const enum Event {
    LOG = "log",
    ERROR = "error",
    IMPORTER_STARTED = "importer.started",
    IMPORTER_STOPPED = "importer.stopped",
    IMPORTER_FINISHED = "importer.finished",
    IMPORTER_FAILED = "importer.failed",
    BACKTESTER_STARTED = "backtester.started",
    BACKTESTER_STOPPED = "backtester.stopped",
    BACKTESTER_FINISHED = "backtester.finished",
    BACKTESTER_FINISHED_HISTORY = "backtester.finished.history",
    BACKTESTER_FAILED = "backtester.failed",
    BACKTESTER_FAILED_HISTORY = "backtester.failed.history",
    ROBOT_STARTED = "robot.started",
    ROBOT_STARTING = "robot.starting",
    ROBOT_STOPPED = "robot.stopped",
    ROBOT_UPDATED = "robot.updated",
    ROBOT_PAUSED = "robot.paused",
    ROBOT_RESUMED = "robot.resumed",
    ROBOT_FAILED = "robot.failed",
    ROBOT_LOG = "robot.log",
    ROBOT_WORKER_RELOAD_CODE = "robot-worker.reload-code",
    USER_ROBOT_STARTED = "user-robot.started",
    USER_ROBOT_STOPPED = "user-robot.stopped",
    USER_ROBOT_UPDATED = "user-robot.updated",
    USER_ROBOT_PAUSED = "user-robot.paused",
    USER_ROBOT_RESUMED = "user-robot.resumed",
    USER_ROBOT_FAILED = "user-robot.failed",
    USER_ROBOT_TRADE = "user-robot.trade",
    CANDLE_NEW = "candle.new",
    TICK_NEW = "tick.new",
    SIGNAL_ALERT = "signal.alert",
    SIGNAL_TRADE = "signal.trade",
    ORDER_STATUS = "order.status",
    ORDER_ERROR = "order.error",
    USER_EX_ACC_ERROR = "user_ex_acc.error",
    STATS_CALC_ROBOT = "stats-calc.robot",
    STATS_CALC_ROBOTS = "stats-calc.robots",
    STATS_CALC_USER_ROBOT = "stats-calc.user-robot",
    STATS_CALC_USER_ROBOTS = "stats-calc.user-robots",
    STATS_CALC_USER_SIGNAL = "stats-calc.user-signal",
    STATS_CALC_USER_SIGNALS = "stats-calc.user-signals",
    MESSAGE_SUPPORT = "message.support",
    MESSAGE_SUPPORT_REPLY = "message.support-reply",
    MESSAGE_BROADCAST = "message.broadcast"
  }

  const enum Status {
    pending = "pending",
    queued = "queued",
    starting = "starting",
    stopping = "stopping",
    started = "started",
    stopped = "stopped",
    paused = "paused",
    finished = "finished",
    failed = "failed"
  }

  const enum Priority {
    high = 1,
    medium = 2,
    low = 3
  }

  const enum TelegramScene {
    SIGNALS = "signals",
    SEARCH_SIGNALS = "searchSignals",
    MY_SIGNALS = "mySignals",
    TOP_SIGNALS = "topSignals",
    ROBOT_SIGNAL = "robotSignal",
    SUBSCRIBE_SIGNALS = "subscribeSignals",
    PERFORMANCE_SIGNALS = "perfSignals",
    ROBOTS = "robots",
    SEARCH_ROBOTS = "searchRobots",
    MY_ROBOTS = "myRobots",
    TOP_ROBOTS = "topRobots",
    USER_ROBOT = "userRobot",
    ADD_USER_ROBOT = "addUserRobot",
    START_USER_ROBOT = "startUserRobot",
    STOP_USER_ROBOT = "stopUserRobot",
    EDIT_USER_ROBOT = "editUserRobot",
    DELETE_USER_ROBOT = "deleteUserRobot",
    PERFORMANCE_ROBOTS = "perfRobots",
    SETTINGS = "settings",
    USER_EXCHANGE_ACCS = "userExAccs",
    USER_EXCHANGE_ACC = "userExAcc",
    ADD_USER_EX_ACC = "addUserExAcc",
    EDIT_USER_EX_ACC = "editUserExAcc",
    SUPPORT = "support"
  }

  const enum cronLock {
    PRIVATE_CONNECTOR_RUNNER_CHECK_ORDERS = "cron:private-connector-runner:check-orders",
    USER_ROBOT_RUNNER_CHECK_JOBS = "cron:user-robot-runner:check-jobs",
    USER_ROBOT_RUNNER_CHECK_ORDERS = "cron:user-robot-runner:check-orders",
    PUBLISHER_SEND_TELEGRAM = "cron:publisher:send-telegram",
    MARKETS_UPDATE = "cron:db-markets:update"
  }

  const enum ExwatcherStatus {
    pending = "pending",
    importing = "importing",
    subscribed = "subscribed",
    unsubscribed = "unsubscribed",
    failed = "failed"
  }

  const enum UserStatus {
    blocked = -1,
    new = 0,
    enabled = 1
  }

  const enum UserMessages {
    by_user_request = "by user request",
    by_admin = "by admin",
    order_error = "order error",
    invalid_exchange_account = "invalid exchange account",
    exchange_error = "exchange error"
  }

  const enum UserRoles {
    admin = "admin",
    manager = "manager",
    vip = "vip",
    user = "user",
    anonymous = "anonymous"
  }

  const enum RobotJobType {
    start = "start",
    stop = "stop",
    pause = "pause",
    candle = "candle",
    tick = "tick"
  }

  const enum PositionDirection {
    long = "long",
    short = "short"
  }

  const enum OrderDirection {
    buy = "buy",
    sell = "sell"
  }

  const enum RobotPositionStatus {
    new = "new",
    open = "open",
    closed = "closed"
  }

  const enum UserPositionStatus {
    delayed = "delayed",
    new = "new",
    open = "open",
    canceled = "canceled",
    closed = "closed",
    closedAuto = "closedAuto"
  }

  const enum RobotTradeStatus {
    new = "new",
    open = "open",
    closed = "closed"
  }

  const enum TradeAction {
    long = "long",
    short = "short",
    closeLong = "closeLong",
    closeShort = "closeShort"
  }

  const enum OrderType {
    stop = "stop",
    limit = "limit",
    market = "market",
    forceMarket = "forceMarket"
  }

  const enum OrderStatus {
    new = "new",
    open = "open",
    closed = "closed",
    canceled = "canceled"
  }

  const enum OrderJobType {
    create = "create",
    recreate = "recreate",
    cancel = "cancel",
    check = "check"
  }

  const enum UserPositionOrderStatus {
    new = "new",
    open = "open",
    partial = "partial",
    closed = "closed",
    canceled = "canceled"
  }

  const enum UserPositionJob {
    open = "open",
    cancel = "cancel",
    close = "close"
  }

  const enum IndicatorType {
    base = "base",
    tulip = "tulip"
    /*talib = "talib",
    techind = "techind"*/
  }

  const enum SignalType {
    alert = "alert",
    trade = "trade"
  }

  const enum CandleType {
    loaded = "loaded",
    created = "created",
    previous = "previous",
    history = "history"
  }

  const enum TimeUnit {
    second = "second",
    minute = "minute",
    hour = "hour",
    day = "day"
  }

  const enum Timeframe {
    "1m" = 1,
    "5m" = 5,
    "15m" = 15,
    "30m" = 30,
    "1h" = 60,
    "2h" = 120,
    "4h" = 240,
    "8h" = 480,
    "12h" = 720,
    "1d" = 1440
  }

  const enum Queue {
    importCandles = "importCandles",
    runRobot = "runRobot",
    backtest = "backtest",
    connector = "connector",
    runUserRobot = "runUserRobot",
    statsCalc = "statsCalc"
  }

  const enum UserExchangeAccStatus {
    enabled = "enabled",
    disabled = "disabled",
    invalid = "invalid"
  }

  const enum UserRobotJobType {
    stop = "stop",
    pause = "pause",
    signal = "signal",
    order = "order"
  }

  type ImportType = "recent" | "history";

  interface MinMax {
    min: number;
    max: number | undefined;
  }

  interface Exchange {
    code: string;
    name: string;
    timeframes?: Timeframe[];
    countries?: string[];
    options?: any;
    available: number;
    type?: string;
  }

  interface Market {
    exchange: string;
    asset: string;
    currency: string;
    precision: { base: number; quote: number; amount: number; price: number };
    limits: { amount: MinMax; price: MinMax; cost?: MinMax };
    averageFee: number;
    loadFrom: string;
  }

  interface OrderJob {
    type: OrderJobType;
    data?: {
      price: number;
    };
  }

  interface ConnectorJob extends OrderJob {
    id: string;
    userExAccId: string;
    orderId: string;
    nextJobAt: string;
    priority: Priority;
  }

  interface ExchangeCandle {
    exchange: string;
    asset: string;
    currency: string;
    timeframe: Timeframe;
    time: number;
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    type: CandleType;
  }

  interface ExchangeCandlesInTimeframes {
    [key: number]: ExchangeCandle[];
  }

  interface DBCandle {
    exchange: string;
    asset: string;
    currency: string;
    id?: string;
    time: number;
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    type: CandleType;
  }

  interface Candle extends DBCandle {
    timeframe: number;
  }

  interface CandleProps {
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
  }

  interface ExchangePrice {
    exchange: string;
    asset: string;
    currency: string;
    time: number;
    timestamp: string;
    price: number;
  }

  interface ExchangeTrade extends ExchangePrice {
    amount: number;
    side: string;
  }

  interface ExwatcherTrade extends ExchangeTrade {
    tradeId: string;
    type: "trade" | "tick";
  }

  interface ExchangeTimeframes {
    [key: string]: Timeframe;
  }

  interface TimeframeProps {
    str: string;
    value: Timeframe;
    unit: TimeUnit;
    amountInUnit: number;
  }

  interface Timeframes {
    [key: number]: TimeframeProps;
  }

  interface Events<T> {
    type: cpz.Event;
    data: T;
  }

  interface RobotEventData extends GenericObject<any> {
    robotId: string;
  }

  interface UserRobotEventData extends GenericObject<any> {
    userRobotId: string;
  }

  interface UserTradeEventData extends UserRobotEventData {
    id: string;
    code: string;
    exchange: string;
    asset: string;
    currency: string;
    userRobotId: string;
    userId: string;
    status: UserPositionStatus;
    entryAction?: TradeAction;
    entryStatus?: UserPositionOrderStatus;
    entrySignalPrice?: number;
    entryPrice?: number;
    entryDate?: string;
    entryCandleTimestamp?: string;
    entryExecuted?: number;
    exitAction?: TradeAction;
    exitStatus?: UserPositionOrderStatus;
    exitPrice?: number;
    exitDate?: string;
    exitCandleTimestamp?: string;
    exitExecuted?: number;
    reason?: string; //TODO ENUM
    profit?: number;
    barsHeld?: number;
  }

  interface TradeInfo {
    action: TradeAction;
    orderType: OrderType;
    price?: number;
  }

  interface AlertInfo extends TradeInfo {
    candleTimestamp: string;
  }

  interface SignalInfo extends AlertInfo {
    type: SignalType;
    positionId: string;
    positionPrefix: string;
    positionCode: string;
    positionParentId?: string;
    positionBarsHeld?: number;
  }

  interface SignalEvent extends SignalInfo {
    id: string;
    robotId: string;
    exchange: string;
    asset: string;
    currency: string;
    timeframe: Timeframe;
    timestamp: string;
    profit?: number; //TODO: move to new event
  }

  interface StatsCalcRobotEvent {
    robotId: string;
  }

  interface StatsCalcUserRobotEvent {
    userRobotId: string;
  }

  interface StatsCalcUserRobotsEvent {
    userId: string;
    exchange: string;
    asset: string;
  }

  interface OrderParams {
    orderTimeout: number;
    kraken?: {
      leverage?: number;
    };
    [key: string]: any;
  }

  interface Order {
    id: string;
    userExAccId: string;
    userRobotId: string;
    positionId: string;
    userPositionId: string;
    exchange: string;
    asset: string;
    currency: string;
    action: cpz.TradeAction;
    direction: cpz.OrderDirection;
    type: cpz.OrderType;
    signalPrice?: number;
    price?: number;
    volume: number;
    params: OrderParams;
    createdAt: string;
    status: OrderStatus;
    exId?: string;
    exTimestamp?: string;
    exLastTradeAt?: string;
    remaining?: number;
    executed?: number;
    fee?: number;
    lastCheckedAt?: string;
    error?: any;
    nextJob?: OrderJob;
  }
  interface Importer {
    id: string;
    exchange: string;
    asset: string;
    currency: string;
    type: cpz.ImportType;
    params: any;
    status: cpz.Status;
    progress?: number;
    startedAt?: string;
    endedAt?: string;
    error?: string;
  }

  interface Exwatcher {
    id: string;
    exchange: string;
    asset: string;
    currency: string;
    status: cpz.ExwatcherStatus;
    nodeID: string;
    importerId: string;
    error?: string;
  }

  interface CodeFilesInDB {
    id: string;
    name: string;
    author?: string;
    available: number;
    file: string;
  }

  interface IndicatorState {
    [key: string]: any;
    name: string;
    indicatorName: string;
    initialized?: boolean;
    parameters?: { [key: string]: number };
    robotSettings?: { [key: string]: any };
    variables?: { [key: string]: any };
    indicatorFunctions?: { [key: string]: () => any };
    parametersSchema?: ValidationSchema;
  }

  interface IndicatorCode {
    [key: string]: any;
    init(): void;
    calc(): void;
  }

  class Indicator {
    constructor(state: cpz.IndicatorState);
    [key: string]: any;
    initialized: boolean;
    parameters?: { [key: string]: number };
    _eventsToSend: cpz.Events<any>[];
    _checkParameters(): void;
    _handleCandles(
      candle: cpz.Candle,
      candles: cpz.Candle[],
      candlesProps: cpz.CandleProps
    ): void;
    init(): void;
    calc(): void;
  }

  interface StrategyProps {
    initialized: boolean;
    posLastNumb: { [key: string]: number };
    positions: cpz.RobotPositionState[];
    indicators: {
      [key: string]: IndicatorState;
    };
    variables: { [key: string]: any };
  }
  interface StrategyState extends StrategyProps {
    parameters?: { [key: string]: number | string };
    robotSettings: { [key: string]: any };
    exchange: string;
    asset: string;
    currency: string;
    timeframe: cpz.Timeframe;
    robotId: string;
    parametersSchema: ValidationSchema;
    strategyFunctions: { [key: string]: () => any };
    backtest?: boolean;
    log?(...args: any): void;
  }

  interface StrategyCode {
    [key: string]: any;
    init(): void;
    check(): void;
  }

  class Strategy {
    constructor(state: cpz.StrategyState);
    [key: string]: any;
    initialized: boolean;
    posLastNumb: { [key: string]: number };
    hasAlerts: boolean;
    hasActivePositions: boolean;
    indicators: {
      [key: string]: cpz.IndicatorState;
    };
    validPositions: RobotPositionState[];
    _eventsToSend: cpz.Events<any>[];
    _positionsToSave: cpz.RobotPositionState[];
    init(): void;
    check(): void;
    _log(...args: any): void;
    log(...args: any): void;
    logEvent(...args: any): void;
    _checkParameters(): void;
    _handleCandles(
      candle: cpz.Candle,
      candles: cpz.Candle[],
      candlesProps: cpz.CandleProps
    ): void;
    _handleIndicators(indicators: { [key: string]: cpz.IndicatorState }): void;
    _clearAlerts(): void;
    _checkAlerts(): void;
  }

  interface PositionDataForStats {
    id: string;
    direction?: PositionDirection;
    exitDate?: string;
    profit?: number;
    barsHeld?: number;
  }

  interface RobotsPostionInternalState {
    [key: string]: any;
    highestHigh?: number;
    lowestLow?: number;
    stop?: number;
  }
  interface RobotPositionState {
    id: string;
    robotId: string;
    timeframe: number;
    volume: number;
    prefix: string;
    code: string;
    parentId?: string;
    direction?: PositionDirection;
    status?: RobotPositionStatus;
    entryStatus?: RobotTradeStatus;
    entryPrice?: number;
    entryDate?: string;
    entryOrderType?: OrderType;
    entryAction?: TradeAction;
    entryCandleTimestamp?: string;
    exitStatus?: RobotTradeStatus;
    exitPrice?: number;
    exitDate?: string;
    exitOrderType?: OrderType;
    exitAction?: TradeAction;
    exitCandleTimestamp?: string;
    alerts?: { [key: string]: cpz.AlertInfo };
    profit?: number;
    barsHeld?: number;
    fee?: number;
    backtest?: boolean;
    internalState?: RobotsPostionInternalState;
  }

  class RobotPosition {
    constructor(state: cpz.RobotPositionState);
    id: string;
    prefix: string;
    code: string;
    parentId: string;
    direction: PositionDirection;
    entryStatus: RobotTradeStatus;
    exitStatus: RobotTradeStatus;
    status: RobotPositionStatus;
    isActive: boolean;
    hasAlerts: boolean;
    hasAlertsToPublish: boolean;
    hasTradeToPublish: boolean;
    state: RobotPositionState;
    internalState: RobotsPostionInternalState;
    highestHigh: number;
    lowestLow: number;
    alertsToPublish: SignalInfo[];
    tradeToPublish: SignalInfo;
    // _initHighLow(timestamp: string, highs: number[], lows: number[]): void;
    _clearAlertsToPublish(): void;
    _clearTradeToPublish(): void;
    _clearAlerts(): void;
    _handleCandle(candle: Candle): void;
    _checkAlerts(): void;
    _log(...args: any): void;
  }

  interface RobotSettings {
    strategyParameters?: { [key: string]: any };
    volume?: number;
    requiredHistoryMaxBars?: number;
  }

  interface RobotTradeSettings {
    orderTimeout: number;
    slippage?: {
      entry?: {
        stepPercent: number;
        count?: number;
      };
      exit?: {
        stepPercent: number;
        count?: number;
      };
    };
    deviation?: {
      entry?: number;
      exit?: number;
    };
  }

  interface RobotStatVals<T> {
    all?: T;
    long?: T;
    short?: T;
  }

  interface RobotStats {
    lastUpdatedAt?: string;
    performance?: { x: number; y: number }[];
    tradesCount?: RobotStatVals<number>;
    tradesWinning?: RobotStatVals<number>;
    tradesLosing?: RobotStatVals<number>;
    winRate?: RobotStatVals<number>;
    lossRate?: RobotStatVals<number>;
    avgBarsHeld?: RobotStatVals<number>;
    avgBarsHeldWinning?: RobotStatVals<number>;
    avgBarsHeldLosing?: RobotStatVals<number>;
    netProfit?: RobotStatVals<number>;
    avgNetProfit?: RobotStatVals<number>;
    grossProfit?: RobotStatVals<number>;
    avgProfit?: RobotStatVals<number>;
    grossLoss?: RobotStatVals<number>;
    avgLoss?: RobotStatVals<number>;
    maxConnsecWins?: RobotStatVals<number>;
    maxConsecLosses?: RobotStatVals<number>;
    maxDrawdown?: RobotStatVals<number>;
    maxDrawdownDate?: RobotStatVals<string>;
    profitFactor?: RobotStatVals<number>;
    recoveryFactor?: RobotStatVals<number>;
    payoffRatio?: RobotStatVals<number>;
  }

  interface RobotEquity {
    profit?: number;
    lastProfit?: number;
    tradesCount?: number;
    winRate?: number;
    maxDrawdown?: number;
    changes?: { x: number; y: number }[];
  }

  interface RobotHead {
    id: string;
    code: string;
    mod: string;
    name: string;
  }

  interface RobotState extends RobotHead {
    exchange: string;
    asset: string;
    currency: string;
    timeframe: Timeframe;
    available?: number;
    strategyName: string;
    settings: RobotSettings;
    tradeSettings?: RobotTradeSettings;
    lastCandle?: Candle;
    state?: StrategyProps;
    hasAlerts?: boolean;
    indicators?: { [key: string]: IndicatorState };
    status?: Status;
    startedAt?: string;
    stoppedAt?: string;
    statistics?: RobotStats;
    equity?: RobotEquity;
    backtest?: boolean;
  }

  interface UserSignalInfo extends AlertInfo {
    code: string;
  }

  interface RobotBaseInfo extends RobotHead {
    exchange: string;
    asset: string;
    currency: string;
    timeframe: Timeframe;
    strategyCode: string;
    strategyName: string;
    description: string;
    settings: RobotSettings;
    available: number;
    signals: boolean;
    trading: boolean;
    status: Status;
    startedAt?: string;
    stoppedAt?: string;
    statistics?: RobotStats;
    equity?: RobotEquity;
  }

  interface RobotInfo extends RobotHead {
    exchange: string;
    asset: string;
    currency: string;
    timeframe: Timeframe;
    strategyCode: string;
    strategyName: string;
    description: string;
    settings: RobotSettings;
    available: number;
    signals: boolean;
    trading: boolean;
    status: Status;
    startedAt?: string;
    stoppedAt?: string;
    statistics?: RobotStats;
    equity?: RobotEquity;
    openPositions: cpz.RobotPositionState[];
    closedPositions: cpz.RobotPositionState[];
    currentSignals: UserSignalInfo[];
  }

  interface UserSignalsInfo extends UserSignals {
    openPositions: cpz.RobotPositionState[];
    closedPositions: cpz.RobotPositionState[];
    currentSignals: UserSignalInfo[];
  }

  interface RobotJob {
    id: string;
    robotId: string;
    type: RobotJobType;
    data?: Candle | ExchangePrice;
  }

  interface BacktesterSettings {
    local?: boolean;
    populateHistory?: boolean;
  }

  interface BacktesterState {
    id: string;
    robotId: string;
    exchange?: string;
    asset?: string;
    currency?: string;
    timeframe?: Timeframe;
    strategyName?: string;
    dateFrom: string;
    dateTo: string;
    settings?: BacktesterSettings;
    robotSettings?: RobotSettings;
    totalBars?: number;
    processedBars?: number;
    leftBars?: number;
    completedPercent?: number;
    status: string;
    startedAt?: string;
    finishedAt?: string;
    statistics?: RobotStats;
    equity?: RobotEquity;
    robotState?: StrategyProps;
    robotIndicators?: { [key: string]: IndicatorState };
    error?: any;
  }

  interface BacktesterPositionState extends RobotPositionState {
    backtestId: string;
  }

  interface BacktesterSignals extends SignalEvent {
    backtestId: string;
  }

  interface UserRolesList {
    allowedRoles: cpz.UserRoles[];
    defaultRole: cpz.UserRoles;
  }

  interface UserSettings {
    notifications: {
      signals: {
        telegram: boolean;
        email: boolean;
      };
      trading: {
        telegram: boolean;
        email: boolean;
      };
    };
  }

  interface User {
    id: string;
    name?: string;
    email?: string;
    emailNew?: string;
    telegramId?: number;
    telegramUsername?: string;
    status: UserStatus;
    passwordHash?: string;
    passwordHashNew?: string;
    secretCode?: string;
    secretCodeExpireAt?: string;
    refreshToken?: string;
    refreshTokenExpireAt?: string;
    roles: UserRolesList;
    settings: UserSettings;
  }

  interface UserSignals {
    id: string;
    robotId: string;
    userId: string;
    subscribedAt: string;
    volume: number;
    statistics?: RobotStats;
    equity?: RobotEquity;
  }

  interface EncryptedData {
    data: string;
    iv: string;
  }

  interface UserExchangeKeys {
    key: EncryptedData;
    secret: EncryptedData;
    pass?: EncryptedData;
  }

  interface UserExchangeAccount {
    id: string;
    userId: string;
    exchange: string;
    name: string;
    keys: UserExchangeKeys;
    status: UserExchangeAccStatus;
    ordersCache: GenericObject<any>;
    error?: any;
  }

  interface UserExchangeAccountErrorEvent {
    id: string;
    userId: string;
    name: string;
    exchange: string;
    error: string;
  }
  interface UserRobotSettings {
    volume: number;
    kraken?: {
      leverage?: number;
    };
  }

  interface UserRobotInternalState {
    latestSignal?: SignalEvent;
    posLastNumb?: GenericObject<number>;
  }
  interface UserRobotDB {
    id: string;
    userExAccId: string;
    userId: string;
    robotId: string;
    settings: UserRobotSettings;
    internalState: UserRobotInternalState;
    status: Status;
    startedAt?: string;
    stoppedAt?: string;
    statistics?: RobotStats;
    equity?: RobotEquity;
    message?: string;
  }

  interface UserRobotState extends UserRobotDB {
    robot: {
      exchange: string;
      asset: string;
      currency: string;
      timeframe: Timeframe;
      tradeSettings: RobotTradeSettings;
    };
    positions: UserPositionState[];
  }

  interface UserRobotInfo extends UserRobotDB {
    userExAccName: string;
    openPositions: cpz.UserPositionDB[];
    closedPositions: cpz.UserPositionDB[];
  }

  class UserRobot {
    constructor(state: UserRobotState);
    state: {
      userRobot: UserRobotDB;
      positions?: UserPositionDB[];
      ordersToCreate?: Order[];
      connectorJobs?: ConnectorJob[];
      eventsToSend?: Events<UserRobotEventData>[];
    };
    _log(...args: any): void;
    handleSignal(signal: SignalEvent): void;
    handleOrder(order: Order): void;
  }

  interface UserRobotJob {
    id: string;
    userRobotId: string;
    type: UserRobotJobType;
    data?: SignalEvent | Order | { message?: string };
  }

  interface UserPositionInternalState {
    entrySlippageCount: number;
    exitSlippageCount: number;
    delayedSignal?: SignalEvent;
  }

  interface UserPositionDB {
    id: string;
    prefix: string;
    code: string;
    positionCode: string;
    positionId: string;
    userRobotId: string;
    userId: string;
    exchange: string;
    asset: string;
    currency: string;
    status: UserPositionStatus;
    parentId?: string;
    direction: PositionDirection;
    entryAction?: TradeAction;
    entryStatus?: UserPositionOrderStatus;
    entrySignalPrice?: number;
    entryPrice?: number;
    entryDate?: string;
    entryCandleTimestamp?: string;
    entryVolume?: number;
    entryExecuted?: number;
    entryRemaining?: number;
    exitAction?: TradeAction;
    exitStatus?: UserPositionOrderStatus;
    exitSignalPrice?: number;
    exitPrice?: number;
    exitDate?: string;
    exitCandleTimestamp?: string;
    exitVolume?: number;
    exitExecuted?: number;
    exitRemaining?: number;
    internalState: UserPositionInternalState;
    reason?: string; //TODO ENUM
    profit?: number;
    barsHeld?: number;
    nextJobAt?: string;
    nextJob?: UserPositionJob;
  }
  interface UserSignalPosition extends RobotPositionState {
    exchange: string;
    asset: string;
    currency: string;
    userId: string;
    userSignalVolume: number;
  }
  interface UserPositionState extends UserPositionDB {
    robot: {
      timeframe: Timeframe;
      tradeSettings: RobotTradeSettings;
    };
    userRobot: {
      userExAccId: string;
      settings: UserRobotSettings;
    };
    entryOrders?: Order[];
    exitOrders?: Order[];
  }

  class UserPosition {
    constructor(state: cpz.UserPositionState);
    id: string;
    prefix: string;
    code: string;
    positionId: string;
    status: UserPositionStatus;
    parentId?: string;
    state: UserPositionDB;
    ordersToCreate: Order[];
    connectorJobs: ConnectorJob[];
    _log(...args: any): void;
    handleSignal(signal: SignalEvent): void;
    //  handleOrder(order: Order): void;
  }

  const enum StatsCalcJobType {
    robot = "robot",
    userSignal = "userSignal",
    userSignals = "userSignals",
    userRobot = "userRobot",
    userSignalsAggr = "userSignalsAggr",
    userRobotAggr = "userRobotAggr"
  }

  interface StatsCalcJob {
    id: string;
    type: StatsCalcJobType;
    robotId?: string;
    userRobotId?: string;
    userId?: string;
    exchange?: string;
    asset?: string;
  }

  interface UserAggrStatsDB {
    id: string;
    userId: string;
    exchange?: string;
    asset?: string;
    type: "signal" | "userRobot";
    statistics: RobotStats;
    equity: RobotEquity;
  }

  interface TelegramMessage {
    telegramId: number;
    message: string;
  }

  interface Message {
    id: string;
    timestamp: string;
    from: string;
    to?: string;
    data: GenericObject<any>;
  }

  interface Notification {
    id: string;
    timestamp: string;
    userId: string;
    robotId?: string;
    userRobotId?: string;
    positionId?: string;
    userPositionId?: string;
    type: Event;
    data: GenericObject<any>;
    sendTelegram?: boolean;
    sendEmail?: boolean;
    readed?: boolean;
  }
}
