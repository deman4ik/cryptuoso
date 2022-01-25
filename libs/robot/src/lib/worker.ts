import { createObjectBuffer, getUnderlyingArrayBuffer, loadObjectBuffer } from "@bnaya/objectbuffer";
import logger from "@cryptuoso/logger";
import { Candle } from "@cryptuoso/market";
import { RobotState, RobotStatus } from "@cryptuoso/robot-state";
import { Transfer, TransferDescriptor } from "threads";

export const worker = {
    async process(stateBuf: TransferDescriptor<ArrayBuffer>) {
        try {
            if (stateBuf instanceof ArrayBuffer) {
                const robotState: { state: RobotState; candles: Candle[] } = loadObjectBuffer(stateBuf);

                logger.debug(robotState.state.status);
                logger.debug(robotState.candles.length);
                robotState.state.status = RobotStatus.stopped;
                return Transfer(stateBuf);
            } else throw new Error("Unknown data from main thread");
        } catch (err) {
            logger.error("Worker error");
            logger.error(err);
            throw err;
        }
    }
};

export type RobotWorker = typeof worker;
