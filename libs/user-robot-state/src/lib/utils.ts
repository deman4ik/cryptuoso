import { keysToCamelCase } from "@cryptuoso/helpers";
import { Order } from "@cryptuoso/market";
import { sql, DatabasePoolType, DatabaseTransactionConnectionType } from "@cryptuoso/postgres";

import { UserPositionDB, UserRobotDB, UserRobotStateExt } from "./types";

export async function getUserRobotState(db: DatabasePoolType, userRobotId: string) {
    const rawData = await db.one<UserRobotStateExt>(sql`
        SELECT * FROM v_user_robot_state WHERE id = ${userRobotId};`);

    return keysToCamelCase(rawData) as UserRobotStateExt;
}

export async function saveUserPositions(transaction: DatabaseTransactionConnectionType, positions: UserPositionDB[]) {
    for (const p of positions) {
        this.log.info(p);
        await transaction.query(sql`
        INSERT INTO user_positions
  ( id, prefix, code,
    position_code, position_id,
    user_robot_id, user_portfolio_id, user_id,
    exchange, asset, currency,
    status, parent_id, direction,
    entry_status, entry_action, entry_signal_price,
    entry_price, entry_date, entry_candle_timestamp,
    entry_volume, entry_executed, entry_remaining,
    exit_status, exit_action, exit_signal_price,
    exit_price, exit_date, exit_candle_timestamp,
    exit_volume, exit_executed, exit_remaining,
    internal_state, reason, profit, bars_held,
    next_job_at, next_job, meta
     ) 
     VALUES (
         ${p.id}, ${p.prefix}, ${p.code}, 
         ${p.positionCode}, ${p.positionId || null},
         ${p.userRobotId}, ${p.userPortfolioId}, ${p.userId},
         ${p.exchange}, ${p.asset}, ${p.currency},
         ${p.status}, ${p.parentId || null}, ${p.direction},
         ${p.entryStatus || null}, ${p.entryAction || null}, ${p.entrySignalPrice || null},
         ${p.entryPrice || null}, ${p.entryDate || null}, ${p.entryCandleTimestamp || null},
         ${p.entryVolume || null}, ${p.entryExecuted || null}, ${p.entryRemaining || null},
         ${p.exitStatus || null}, ${p.exitAction || null}, ${p.exitSignalPrice || null},
         ${p.exitPrice || null}, ${p.exitDate || null}, ${p.exitCandleTimestamp || null},
         ${p.exitVolume || null}, ${p.exitExecuted || null}, ${p.exitRemaining || null},
         ${JSON.stringify(p.internalState) || null}, ${p.reason || null},
         ${p.profit || null}, ${p.barsHeld || null},
         ${p.nextJobAt || null}, ${p.nextJob || null},
         ${JSON.stringify(p.meta)}
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
      next_job = excluded.next_job,
      meta = excluded.meta;
        `);
    }
}

export async function saveUserOrders(transaction: DatabaseTransactionConnectionType, orders: Order[]) {
    for (const order of orders) {
        this.log.info(order);
        await transaction.query(sql`
        INSERT INTO user_orders
        (
            id, user_ex_acc_id, user_robot_id, 
            position_id, user_position_id,
            prev_order_id,
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
            ${order.prevOrderId || null},
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
}

export async function saveUserRobotState(transaction: DatabaseTransactionConnectionType, state: UserRobotDB) {
    await transaction.query(sql`
        UPDATE user_robots
           SET internal_state = ${JSON.stringify(state.internalState) || null},
               robot_state = ${JSON.stringify(state.robotState) || null},
               status = ${state.status},
               started_at = ${state.startedAt || null},
               stopped_at = ${state.stoppedAt || null},
               message = ${state.message || null}
         WHERE id = ${state.id};
    `);
}
