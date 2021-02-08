import { Client, resources } from "coinbase-commerce-node";
import retry from "async-retry";
import logger from "@cryptuoso/logger";
import { UserPayment } from "./types";

class CoinbaseCommerce {
    retryOptions = {
        retries: 10,
        minTimeout: 1000,
        maxTimeout: 5000,
        onRetry: (err: any, i: number) => {
            if (err) {
                logger.warn(`Retry ${i} - ${err.message}`);
            }
        }
    };
    constructor() {
        Client.init(process.env.COINBASE_COMMERCE_API_KEY);
    }

    mapChargeToUserPayment(userId: string, userSubId: string, charge: resources.Charge): UserPayment {
        return {
            id: charge.id,
            userId,
            userSubId,
            provider: "coinbase.commerce",
            status: charge.timeline[charge.timeline.length - 1].status, //sort by timestamp ?
            expiresAt: charge.expires_at,
            addresses: charge.addresses,
            code: charge.code,
            pricing: charge.pricing,
            price: +charge.pricing.local.amount,
            info: charge,
            createdAt: charge.created_at
        };
    }

    async getCharge(chargeId: string) {
        try {
            const call = async (bail: (e: Error) => void) => {
                try {
                    return await resources.Charge.retrieve(chargeId);
                } catch (e) {
                    if (e.message.includes("limit")) bail(e);
                    else throw e;
                }
            };
            const result = await retry(call, this.retryOptions);

            return result;
        } catch (error) {
            logger.error(`Failed to get charge #${chargeId} - ${error.message}`, error);
            throw error;
        }
    }

    async createCharge({
        userId,
        userSubId,
        subscriptionId,
        subscriptionOption,
        name,
        description,
        price
    }: {
        userId: string;
        userSubId: string;
        subscriptionId: string;
        subscriptionOption: string;
        name: string;
        description: string;
        price: number;
    }): Promise<UserPayment> {
        try {
            const call = async (bail: (e: Error) => void) => {
                try {
                    return await resources.Charge.create({
                        name,
                        description,
                        local_price: {
                            amount: `${0.01}`, //TODO: price
                            currency: "USD"
                        },
                        pricing_type: "fixed_price",
                        metadata: {
                            userId,
                            userSubId,
                            subscriptionId,
                            subscriptionOption
                        }
                    });
                } catch (e) {
                    if (e.message.includes("limit")) bail(e);
                    else throw e;
                }
            };
            const result = await retry(call, this.retryOptions);

            return this.mapChargeToUserPayment(userId, userSubId, result);
        } catch (error) {
            logger.error(`Failed to get create charge for #${userSubId} - ${error.message}`, error);
            throw error;
        }
    }
}

const coinbaseCommerce = new CoinbaseCommerce();

export { coinbaseCommerce };
