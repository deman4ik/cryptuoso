import { GenericObject } from "@cryptuoso/helpers";
import { sql } from "@cryptuoso/postgres";
import { HTTPService, HTTPServiceConfig, RequestExtended } from "@cryptuoso/service";
import { User, UserExchangeAccount, UserExchangeAccStatus, UserRoles } from "@cryptuoso/user-state";
import { UserRobotDB } from "@cryptuoso/user-robot-state";
import { ActionsHandlerError } from "@cryptuoso/errors";
import { RobotStatus } from "@cryptuoso/robot-state";
import dayjs from "@cryptuoso/dayjs";

export type UserRobotRunnerServiceConfig = HTTPServiceConfig;

export default class UserRobotRunnerService extends HTTPService {
    #robotJobRetries = 3;
    constructor(config?: UserRobotRunnerServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                start: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        id: "string"
                    },
                    handler: this._httpHandler.bind(this, this.start.bind(this))
                },
                stop: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        id: "string"
                    },
                    handler: this._httpHandler.bind(this, this.stop.bind(this))
                }
                /* TODO
                pause: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        id: "string"
                    },
                    handler: this._httpHandler.bind(this, this.pause.bind(this))
                } */
                /* TODO
                resume: {
                    auth: true,
                    roles: [UserRoles.user, UserRoles.vip, UserRoles.manager],
                    inputSchema: {
                        id: "string"
                    },
                    handler: this._httpHandler.bind(this, this.resume.bind(this))
                } */
            });
            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error(err, "While constructing UserRobotRunnerService");
        }
    }

    async onServiceStart() {
        this.createQueue("userRobot");
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

    async start(user: User, { id }: { id: string }) {
        const { id: userId } = user;

        const userRobot = await this.db.pg.maybeOne<{
            id: UserRobotDB["id"];
            userId: UserRobotDB["userId"];
            userExAccId: UserRobotDB["userExAccId"];
            status: UserRobotDB["status"];
        }>(sql`
            SELECT ur.id, ur.user_id, ur.user_ex_acc_id, ur.status
            FROM user_robots ur
            WHERE  ur.id = ${id};
        `);

        if (!userRobot) throw new ActionsHandlerError("User Robot not found", { userRobotId: id }, "NOT_FOUND", 404);

        if (userRobot.userId !== userId)
            throw new ActionsHandlerError(
                "Current user isn't owner of this User Robot",
                { userRobotId: id },
                "FORBIDDEN",
                403
            );

        if (userRobot.status === RobotStatus.started) {
            return { status: userRobot.status };
        }

        const userExchangeAccount = await this.db.pg.maybeOne<{
            id: UserExchangeAccount["id"];
            name: UserExchangeAccount["name"];
            status: UserExchangeAccount["status"];
        }>(sql`
                SELECT id, name, status
                FROM user_exchange_accs
                WHERE id = ${userRobot.userExAccId};
            `);

        if (!userExchangeAccount)
            throw new ActionsHandlerError(
                "User Exchange Account not found",
                { userExAccId: userRobot.userExAccId },
                "NOT_FOUND",
                404
            );
        if (userExchangeAccount.status !== UserExchangeAccStatus.enabled)
            throw new ActionsHandlerError(
                `User Exchange Account ${userExchangeAccount.name} is not enabled.`,
                null,
                "FORBIDDEN",
                403
            );

        /* TODO: 
        if (userRobot.status === RobotStatus.paused) {
            return this.resumeRobot(user, { id });
        } */

        await this.db.pg.query(sql`
        UPDATE user_robots 
        SET status = ${RobotStatus.started},
        message = null,
        started_at = ${dayjs.utc().toISOString()},
        error = null,
        stopped_at = null,
        latest_signal = null
        WHERE id = ${id};
        `);
    }

    async stop(user: User, { id }: { id: string }) {
        const { id: userId } = user;

        const userRobot = await this.db.pg.maybeOne<{
            id: UserRobotDB["id"];
            userId: UserRobotDB["userId"];
            status: UserRobotDB["status"];
        }>(sql`
            SELECT ur.id, ur.user_id, ur.status
            FROM user_robots ur
            WHERE  ur.id = ${id};
        `);

        if (!userRobot) throw new ActionsHandlerError("User Robot not found", { userRobotId: id }, "NOT_FOUND", 404);

        if (userRobot.userId !== userId)
            throw new ActionsHandlerError(
                "Current user isn't owner of this User Robot",
                { userRobotId: id },
                "FORBIDDEN",
                403
            );

        if (userRobot.status === RobotStatus.stopped || userRobot.status === RobotStatus.stopping) {
            return { status: userRobot.status };
        }

        //TODO: Checks and job

        await this.db.pg.query(sql`
        UPDATE user_robots 
        SET status = ${RobotStatus.stopped},
        stopped_at =  ${dayjs.utc().toISOString()}
        WHERE id = ${id};
        `);
    }
}
