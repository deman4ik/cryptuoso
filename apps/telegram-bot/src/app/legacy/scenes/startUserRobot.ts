import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { Robot, TelegramScene } from "../types";
import { addBaseActions, getConfirmMenu } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { gql } from "@cryptuoso/graphql-client";
import { GA } from "@cryptuoso/analytics";

async function startUserRobotEnter(ctx: any) {
    try {
        GA.view(ctx.session.user.id, TelegramScene.START_USER_ROBOT);
        const { robot }: { robot: Robot } = ctx.scene.state;

        return ctx.reply(
            ctx.i18n.t("scenes.startUserRobot.confirm", {
                code: robot.code
            }),
            getConfirmMenu(ctx)
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function startUserRobotYes(ctx: any) {
    try {
        const { robot } = ctx.scene.state;
        const {
            userRobot: { id }
        } = robot;

        let error;
        let result;
        try {
            ({
                userRobotStart: { result }
            } = await this.gqlClient.request(
                gql`
                    mutation UserRobotStart($id: uuid!) {
                        userRobotStart(id: $id) {
                            result
                        }
                    }
                `,
                { id },
                ctx
            ));
        } catch (err) {
            error = err.message;
        }

        if (error) {
            await ctx.reply(
                ctx.i18n.t("scenes.startUserRobot.failed", {
                    code: robot.code,
                    error
                }),
                Extra.HTML()
            );
            return startUserRobotBack.call(this, ctx);
        }

        if (result) {
            await ctx.reply(
                ctx.i18n.t("scenes.startUserRobot.success", {
                    code: robot.code
                }),
                Extra.HTML()
            );
        }
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function startUserRobotBack(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.USER_ROBOT, {
            ...ctx.scene.state.prevState,
            edit: false,
            reload: true
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export function startUserRobotScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.START_USER_ROBOT);
    scene.enter(startUserRobotEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.action(/yes/, startUserRobotYes.bind(service));
    scene.action(/no/, startUserRobotBack.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), startUserRobotBack.bind(service));
    scene.command("back", startUserRobotBack.bind(service));
    return scene;
}
