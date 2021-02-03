import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { Webhook } from "coinbase-commerce-node";

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
            rawBody: string;
            headers: { [key: string]: string };
        },
        res: any
    ) {
        try {
            const event = Webhook.verifyEventBody(
                req.rawBody,
                req.headers["x-cc-webhook-signature"],
                process.env.COINBASE_COMMERCE_SECRET
            );
            this.log.debug(event);
            res.send(200);
        } catch (error) {
            this.log.error(error);
            res.send(400);
        } finally {
            res.end();
        }
    }
}
