import ua from "universal-analytics";
import logger from "@cryptuoso/logger";

class GoogleAnalytics {
    init(userId: string) {
        return ua(process.env.GA_UA_TRACKING_ID, {
            uid: userId
        });
    }

    event(userId: string, category: string, action: string) {
        try {
            const visitor = this.init(userId);
            visitor.event(category, action).send();
        } catch (error) {
            logger.error("Failed to send event to analytics", error);
        }
    }

    purchase(userId: string, chargeCode: string, price: number, subscription: string) {
        try {
            const visitor = this.init(userId);
            visitor.transaction(chargeCode, price).item(price, 1, subscription).send();
        } catch (error) {
            logger.error("Failed to send purchase event to analytics", error);
        }
    }

    view(userId: string, screenName: string, appName = "telegram") {
        try {
            const visitor = this.init(userId);
            visitor.screenview(screenName, appName).send();
        } catch (error) {
            logger.error("Failed to view event to analytics", error);
        }
    }
}

const GA = new GoogleAnalytics();
export { GA };
