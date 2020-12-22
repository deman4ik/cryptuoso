import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { Robot, TelegramScene } from "../types";
import { addBaseActions, getConfirmMenu } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { gql } from "@cryptuoso/graphql-client";

async function stopUserRobotEnter(ctx: any) {
    try {
        const { robot }: { robot: Robot } = ctx.scene.state;

        return ctx.reply(
            ctx.i18n.t("scenes.stopUserRobot.confirm", {
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

async function stopUserRobotYes(ctx: any) {
    try {
        const { robot } = ctx.scene.state;
        const {
            userRobot: { id }
        } = robot;

        let error;
        let result;
        try {
            ({
                userRobotStop: { result }
            } = await this.gqlClient.request(
                gql`
                    mutation UserRobotStop($id: uuid!) {
                        userRobotStop(id: $id) {
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
                ctx.i18n.t("scenes.stopUserRobot.failed", {
                    code: robot.code,
                    error
                }),
                Extra.HTML()
            );
            return stopUserRobotBack.call(this, ctx);
        }

        if (result) {
            await ctx.reply(
                ctx.i18n.t("scenes.stopUserRobot.success", {
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

async function stopUserRobotBack(ctx: any) {
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

export function stopUserRobotScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.STOP_USER_ROBOT);
    scene.enter(stopUserRobotEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.action(/yes/, stopUserRobotYes.bind(service));
    scene.action(/no/, stopUserRobotBack.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), stopUserRobotBack.bind(service));
    scene.command("back", stopUserRobotBack.bind(service));
    return scene;
}
