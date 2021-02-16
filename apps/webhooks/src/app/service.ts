import { sql } from "@cryptuoso/postgres";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { Webhook } from "coinbase-commerce-node";
import { UserSubCheckPayment, UserSubInEvents } from "@cryptuoso/user-sub-events";

export type WebhooksServiceConfig = HTTPServiceConfig;

export default class WebhooksService extends HTTPService {
    constructor(config?: WebhooksServiceConfig) {
        super({ ...config, enableActions: false, enableWebhooks: true });
        try {
            this.createWebhooks({
                coinbaseCommerceEvents: {
                    handler: this.handleCoinbaseCommerceEvents
                }
            });
        } catch (err) {
            this.log.error("Failed to initialize WebhooksService", err);
        }
    }

    async handleCoinbaseCommerceEvents(
        req: {
            body: any;
            headers: { [key: string]: string };
        },
        res: any
    ) {
        try {
            this.log.debug(req);
            const event = Webhook.verifyEventBody(
                JSON.stringify(req.body),
                req.headers["x-cc-webhook-signature"],
                process.env.COINBASE_COMMERCE_SECRET
            );
            this.log.debug(event);

            await this.db.pg.query(sql`INSERT INTO coinbase_commerce_events
            (id, resource, type, api_version, data, created_at)
            VALUES (
                ${event.id},
                ${event.resource},
                ${event.type},
                ${event.api_version},
                ${JSON.stringify(event.data)},
                ${event.created_at}
            ) ON CONFLICT ON CONSTRAINT coinbase_commerce_events_pkey
            DO NOTHING;`);

            if (event.type.includes("charge") && event.type !== "charge:created")
                await this.events.emit<UserSubCheckPayment>({
                    type: UserSubInEvents.CHECK_PAYMENT,
                    data: {
                        chargeId: event.data.id,
                        provider: "coinbase.commerce"
                    }
                });
            res.send(200);
        } catch (error) {
            this.log.error(error);
            res.send(400);
        } finally {
            res.end();
        }
    }
}
