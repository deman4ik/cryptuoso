import { sql } from "@cryptuoso/postgres";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import {
    Queues,
    UserRobotDB,
    UserRobotJob,
    UserRobotJobType,
    UserRobotState,
    UserRobotStatus,
    UserRobot,
    UserPositionDB
} from "@cryptuoso/user-robot-state";
import { UserRobotWorkerError, UserRobotWorkerEvents, UserTradeEvents } from "@cryptuoso/user-robot-events";
import { Job } from "bullmq";
import { Order, SignalEvent } from "@cryptuoso/market";
import { ConnectorRunnerEvents, OrdersStatusEvent } from "@cryptuoso/connector-events";
import { BaseError } from "@cryptuoso/errors";
import { NewEvent } from "@cryptuoso/events";
import { StatsCalcRunnerEvents } from "@cryptuoso/stats-calc-events";
import { DatabaseTransactionConnectionType } from "slonik";
import {
    calcAssetDynamicDelta,
    calcBalancePercent,
    calcCurrencyDynamic,
    VolumeSettingsType
} from "@cryptuoso/robot-settings";
import dayjs from "@cryptuoso/dayjs";

export type UserRobotRunnerServiceConfig = BaseServiceConfig;

export default class UserRobotRunnerService extends BaseService {
    #jobRetries = 3;
    constructor(config?: UserRobotRunnerServiceConfig) {
        super(config);
        try {
            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error(err, "While constructing UserRobotRunnerService");
        }
    }

    async onServiceStart() {
        this.createWorker(Queues.userRobot, this.process);
    }

    #getNextJob = (userRobotId: string): Promise<UserRobotJob> =>
        this.db.pg.maybeOne<UserRobotJob>(sql`
 SELECT id, user_robot_id, type, data, retries
  FROM user_robot_jobs
 WHERE user_robot_id = ${userRobotId}
   AND (retries is null OR retries <= ${this.#jobRetries})
 ORDER BY created_at 
  LIMIT 1;  
 `);

    async process(job: Job) {
        const beacon = this.lightship.createBeacon();
        try {
            const userRobotId = job.id;
            let nextJob: UserRobotJob = await this.#getNextJob(userRobotId);

            if (nextJob) {
                while (nextJob) {
                    const status: UserRobotStatus = await this.run(nextJob);

                    if (status && status !== UserRobotStatus.stopped && status !== UserRobotStatus.paused) {
                        nextJob = await this.#getNextJob(userRobotId);
                    } else {
                        nextJob = null;
                    }
                }
            }
            await beacon.die();
        } catch (err) {
            this.log.error(`Error while processing job ${job.id}`, err);
            throw err;
        }
    }

    #getUserRobotState = async (userRobotId: string) =>
        this.db.pg.one<UserRobotState>(sql`
    SELECT ur.id,
           ur.user_ex_acc_id,
           ur.user_id,
           ur.robot_id,
           ur.internal_state,
           ur.status,
           ur.started_at,
           ur.stopped_at,
           ur.message,
           r.exchange,
           r.asset,
           r.currency,
           r.timeframe,
           m.current_price,
           m.limits->'userRobot' as limits,
           a.used_balance_percent, 
           ea.total_balance_usd,
           st.net_profit as profit,
           m.asset_dynamic_delta,
           m.trade_settings,
           urs.user_robot_settings,
           (SELECT array_to_json(array_agg(pos))
FROM
(SELECT p.*,
  (SELECT array_to_json(array_agg(eo))
   FROM
     (SELECT o.*
      FROM user_orders o
      WHERE o.user_position_id = p.id
        AND (o.action = 'long'
             OR o.action = 'short') order by o.created_at asc) eo) AS entry_orders,
  (SELECT array_to_json(array_agg(eo))
   FROM
     (SELECT o.*
      FROM user_orders o
      WHERE o.user_position_id = p.id
        AND (o.action = 'closeLong'
             OR o.action = 'closeShort') order by o.created_at asc) eo) AS exit_orders
FROM user_positions p
WHERE p.user_robot_id = ur.id
  AND p.status IN ('delayed',
                   'new',
                   'open')) pos) AS positions
    FROM user_robots ur, robots r, 
    v_user_markets m, v_user_robot_settings urs, 
    v_user_amounts a, v_user_exchange_accs ea
    LEFT JOIN v_user_robot_stats st
    ON st.user_robot_id = ur.ud
    WHERE ur.robot_id = r.id  
      AND m.exchange = r.exchange
      AND m.asset = r.asset
      AND m.currency = r.currency
      AND m.user_id = ur.user_id    
	  AND urs.user_robot_id = ur.id
      AND a.user_id = ur.user_id
      AND ea.id = ur.user_ex_acc_id
      AND ur.id = ${userRobotId};                   
  `);

    #getCurrentVolume = (state: UserRobotState) => {
        const { userRobotSettings } = state;
        let volume: number;

        if (userRobotSettings.volumeType === VolumeSettingsType.assetStatic) {
            volume = userRobotSettings.volume;
        } else if (userRobotSettings.volumeType === VolumeSettingsType.currencyDynamic) {
            const { volumeInCurrency } = userRobotSettings;
            volume = calcCurrencyDynamic(volumeInCurrency, state.currentPrice);
        } else if (userRobotSettings.volumeType === VolumeSettingsType.assetDynamicDelta) {
            const { initialVolume } = userRobotSettings;

            volume = calcAssetDynamicDelta(initialVolume, state.assetDynamicDelta, state.profit);
        } else if (userRobotSettings.volumeType === VolumeSettingsType.balancePercent) {
            const { balancePercent } = userRobotSettings;

            volume = calcBalancePercent(balancePercent, state.totalBalanceUsd, state.currentPrice);
        } else throw new BaseError("Unknown volume type", userRobotSettings);

        if (volume < state.limits.min.amount) volume = state.limits.min.amount;
        else if (state.limits.max?.amount && volume > state.limits.max?.amount) volume = state.limits.max?.amount;
        return { volume };
    };

    #savePositions = async (transaction: DatabaseTransactionConnectionType, positions: UserPositionDB[]) => {
        for (const p of positions) {
            await transaction.query(sql`
            INSERT INTO user_positions
      ( id, prefix, code,
        position_code, position_id,
        user_robot_id, user_id,
        exchange, asset, currency,
        status, parent_id, direction,
        entry_status, entry_action, entry_signal_price,
        entry_price, entry_date, entry_candle_timestamp,
        entry_volume, entry_executed, entry_remaining,
        exit_status, exit_action, exit_signal_price,
        exit_price, exit_date, exit_candle_timestamp,
        exit_volume, exit_executed, exit_remaining,
        internal_state, reason, profit, bars_held,
        next_job_at, next_job
         ) 
         VALUES (
             ${p.id}, ${p.prefix}, ${p.code}, 
             ${p.positionCode}, ${p.positionId || null},
             ${p.userRobotId}, ${p.userId},
             ${p.exchange}, ${p.asset}, ${p.currency},
             ${p.status}, ${p.parentId || null}, ${p.direction},
             ${p.entryStatus || null}, ${p.entryAction || null}, ${p.entrySignalPrice || null},
             ${p.entryPrice || null}, ${p.entryDate || null}, ${p.entryCandleTimestamp || null},
             ${p.entryVolume || null}, ${p.entryExecuted || null}, ${p.entryRemaining || null},
             ${p.exitStatus || null}, ${p.exitAction || null}, ${p.exitSignalPrice || null},
             ${p.exitPrice || null}, ${p.exitDate || null}, ${p.exitCandleTimestamp || null},
             ${p.exitVolume || null}, ${p.exitExecuted || null}, ${p.exitRemaining || null},
             ${JSON.stringify(p.internalState) || null}, ${p.reason || null}, ${p.profit || null}, ${
                p.barsHeld || null
            },
             ${p.nextJobAt || null}, ${JSON.stringify(p.nextJob) || null}
         )
          ON CONFLICT ON CONSTRAINT user_positions_pkey 
          DO UPDATE SET updated_at = now(),
          status = excluded.status,
          entry_status = excluded.entry_status,
          entry_action = excluded.entry_action,
          entry_signal_price = excluded.entry_signal_price,
          entry_price = excluded.entry_price,
          entry_date = excluded.entry_date,
          entry_candle_timestamp = excluded.entry_candle_timestamp,
          entry_volume = excluded.entry_volume,
          entry_executed = excluded.entry_executed,
          entry_remaining = excluded.entry_remaining,
          exit_status = excluded.exit_status,
          exit_action = excluded.exit_action,
          exit_signal_price = excluded.exit_signal_price,
          exit_price = excluded.exit_price,
          exit_date = excluded.exit_date,
          exit_candle_timestamp = excluded.exit_candle_timestamp,
          exit_volume = excluded.exit_volume,
          exit_executed = excluded.exit_executed,
          exit_remaining = excluded.exit_remaining,
          internal_state = excluded.internal_state,
          reason = excluded.reason,
          profit = excluded.profit,
          bars_held = excluded.bars_held,
          next_job_at = excluded.next_job_at,
          next_job = excluded.next_job;
            `);
        }
    };

    #saveOrders = async (transaction: DatabaseTransactionConnectionType, orders: Order[]) => {
        for (const order of orders) {
            await transaction.query(sql`
            INSERT INTO user_orders
            (
                id, user_ex_acc_id, user_robot_id, 
                position_id, user_position_id,
                exchange, asset, currency,
                action, direction, type,
                signal_price, price, 
                volume, status, 
                ex_id, ex_timestamp, ex_last_trade_at,
                remaining, executed, fee, 
                last_checked_at, params,
                error, next_job
            ) VALUES (
                ${order.id}, ${order.userExAccId}, ${order.userRobotId},
                ${order.positionId || null}, ${order.userPositionId},
                ${order.exchange}, ${order.asset}, ${order.currency},
                ${order.action}, ${order.direction}, ${order.type}, 
                ${order.signalPrice || null}, ${order.price || null},
                ${order.volume}, ${order.status},
                ${order.exId || null}, ${order.exTimestamp || null}, ${order.exLastTradeAt || null},
                ${order.remaining || null}, ${order.executed || null}, ${order.fee || null},
                ${order.lastCheckedAt || null}, ${JSON.stringify(order.params) || null},
                ${order.error || null}, ${JSON.stringify(order.nextJob) || null}
            );
            `);
        }
    };

    #saveState = async (transaction: DatabaseTransactionConnectionType, state: UserRobotDB) => {
        await transaction.query(sql`
            UPDATE user_robots
               SET internalState = ${JSON.stringify(state.internalState) || null},
                   status = ${state.status},
                   started_at = ${state.startedAt || null},
                   stopped_at = ${state.stoppedAt},
                   message = ${state.message}
             WHERE id = ${state.id};
        `);
    };
    async run(job: UserRobotJob): Promise<UserRobotStatus> {
        const { id, userRobotId, type, data } = job;
        this.log.info(`User robot #${userRobotId} - Processing ${type} job`);

        try {
            const userRobotState = await this.#getUserRobotState(userRobotId);

            const settings = await this.#getCurrentVolume(userRobotState);

            const userRobot = new UserRobot({ ...userRobotState, settings });
            const eventsToSend: NewEvent<any>[] = [];
            if (type === UserRobotJobType.signal) {
                userRobot.handleSignal(data as SignalEvent);
            } else if (type === UserRobotJobType.order) {
                userRobot.handleOrder(data as OrdersStatusEvent);
            } else if (type === UserRobotJobType.stop) {
                if (userRobot.status === UserRobotStatus.stopping || userRobot.status === UserRobotStatus.stopped)
                    return userRobot.status;
                userRobot.stop(data as { message?: string });
            } else if (type === UserRobotJobType.pause) {
                if (userRobot.status === UserRobotStatus.paused || userRobot.status === UserRobotStatus.stopped)
                    return userRobot.status;
                userRobot.pause(data as { message?: string });
                eventsToSend.push({
                    type: UserRobotWorkerEvents.PAUSED,
                    data: {
                        userRobotId,
                        timestamp: dayjs.utc().toISOString(),
                        status: UserRobotStatus.paused,
                        message: userRobot.message
                    }
                });
            } else throw new BaseError(`Unknown user robot job type "${type}"`, job);

            if (userRobot.status === UserRobotStatus.stopping && !userRobot.hasActivePositions) {
                userRobot.setStop();
                eventsToSend.push({
                    type: UserRobotWorkerEvents.STOPPED,
                    data: {
                        userRobotId,
                        timestamp: userRobot.stoppedAt,
                        status: UserRobotStatus.stopped,
                        message: userRobot.message
                    }
                });
                this.log.info(`User Robot #${userRobot.id} stopped!`);
            }

            if (userRobot.positions.length) {
                if (userRobot.connectorJobs.length) {
                    for (const connectorJob of userRobot.connectorJobs) {
                        eventsToSend.push({
                            type: ConnectorRunnerEvents.ADD_JOB,
                            data: connectorJob
                        });
                    }
                }

                if (userRobot.hasCanceledPositions) {
                    this.log.error(`User Robot #${userRobot.id} has canceled positions!`);
                }

                if (userRobot.hasClosedPositions) {
                    this.log.info(
                        `User Robot #${userRobot.id} has closed positions, sending ${StatsCalcRunnerEvents.USER_ROBOT} event.`
                    );
                    eventsToSend.push({
                        type: StatsCalcRunnerEvents.USER_ROBOT,
                        data: {
                            userRobotId: userRobot.id
                        }
                    });
                }

                if (userRobot.recentTrades.length) {
                    for (const trade of userRobot.recentTrades) {
                        eventsToSend.push({
                            type: UserTradeEvents.TRADE,
                            data: trade
                        });
                    }
                }
            }

            await this.db.pg.transaction(async (t) => {
                if (userRobot.positions.length) {
                    await this.#savePositions(t, userRobot.positions);

                    if (userRobot.ordersToCreate.length) {
                        await this.#saveOrders(t, userRobot.ordersToCreate);
                    }
                }

                await this.#saveState(t, userRobot.state);

                await t.query(sql`DELETE FROM user_robot_jobs WHERE id = ${job.id};`);
            });

            if (eventsToSend.length) {
                for (const event of eventsToSend) {
                    await this.events.emit(event);
                }
            }

            return userRobot.status;
        } catch (err) {
            this.log.error(`Robot #${userRobotId} processing ${type} job #${id} error`, err);
            try {
                const retries = job.retries ? job.retries + 1 : 1;
                await this.db.pg.query(sql`
                    UPDATE user_robot_jobs
                    SET retries = ${retries}, 
                        error = ${err.message}
                    WHERE id = ${job.id};`);
            } catch (e) {
                this.log.error(`Failed to update user robot's #${userRobotId} failed job status`, e);
            }

            if (job.retries >= this.#jobRetries) {
                await this.events.emit<UserRobotWorkerError>({
                    type: UserRobotWorkerEvents.ERROR,
                    data: {
                        userRobotId,
                        timestamp: dayjs.utc().toISOString(),
                        error: err.message,
                        job
                    }
                });
            }
        }
    }
}
