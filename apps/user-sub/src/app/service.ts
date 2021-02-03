import { UserPayment } from "@cryptuoso/billing";
import { GenericObject } from "@cryptuoso/helpers";
import { HTTPService, HTTPServiceConfig, RequestExtended } from "@cryptuoso/service";
import { User, UserRoles } from "@cryptuoso/user-state";
import {
    UserSubCancel,
    UserSubCheckout,
    UserSubCheckPayment,
    UserSubCreate,
    UserSubEvents,
    UserSubSchema
} from "@cryptuoso/user-sub-events";

export type UserSubServiceConfig = HTTPServiceConfig;

export default class UserSubService extends HTTPService {
    constructor(config?: UserSubServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                createUserSub: {
                    inputSchema: UserSubSchema[UserSubEvents.CREATE],
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    handler: this._httpHandler.bind(this, this.createUserSub.bind(this))
                },
                cancelUserSub: {
                    inputSchema: UserSubSchema[UserSubEvents.CANCEL],
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    handler: this._httpHandler.bind(this, this.cancelUserSub.bind(this))
                },
                checkoutUserSub: {
                    inputSchema: UserSubSchema[UserSubEvents.CHECKOUT],
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    handler: this._httpHandler.bind(this, this.checkoutUserSub.bind(this))
                },
                checkPayment: {
                    inputSchema: UserSubSchema[UserSubEvents.CHECKOUT],
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    handler: this._httpHandler.bind(this, this.checkPayment.bind(this))
                }
            });
        } catch (err) {
            this.log.error("Failed to initialize UserSubService", err);
        }
    }

    async _httpHandler(
        handler: (user: User, params: GenericObject<any>) => Promise<GenericObject<any>>,
        req: RequestExtended,
        res: any
    ) {
        const result = await handler(req.meta.user, req.body.input);

        res.send({ result: result || "OK" });
        res.end();
    }

    async createUserSub(user: User, { subsciptionId, subscriptionOption }: UserSubCreate): Promise<UserPayment | null> {
        return null;
    }

    async cancelUserSub(user: User, { subsciptionId }: UserSubCancel) {
        return;
    }

    async checkoutUserSub(user: User, { subsciptionId }: UserSubCheckout): Promise<UserPayment | null> {
        return null;
    }

    async checkPayment(user: User, { code, provider }: UserSubCheckPayment) {
        return { userSubId: "12345" };
    }
}
