import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { Robot, TelegramScene } from "../types";
import { addBaseActions, getConfirmMenu } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { gql } from "@cryptuoso/graphql-client";
import { GA } from "@cryptuoso/analytics";

async function deleteUserRobotEnter(ctx: any) {
    try {
        GA.view(ctx.session.user.id, TelegramScene.DELETE_USER_ROBOT);
        const { robot }: { robot: Robot } = ctx.scene.state;

        return ctx.reply(
            ctx.i18n.t("scenes.deleteUserRobot.confirm", {
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

async function deleteUserRobotYes(ctx: any) {
    try {
        const { robot } = ctx.scene.state;
        const {
            userRobot: { id }
        } = robot;

        let error;
        let result;
        try {
            ({
                userRobotDelete: { result }
            } = await this.gqlClient.request(
                gql`
                    mutation UserRobotDelete($id: uuid!) {
                        userRobotDelete(id: $id) {
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
                ctx.i18n.t("scenes.deleteUserRobot.failed", {
                    code: robot.code,
                    error
                }),
                Extra.HTML()
            );
            return deleteUserRobotBack.call(this, ctx);
        }

        if (result) {
            await ctx.reply(
                ctx.i18n.t("scenes.deleteUserRobot.success", {
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

async function deleteUserRobotBack(ctx: any) {
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

export function deleteUserRobotScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.DELETE_USER_ROBOT);
    scene.enter(deleteUserRobotEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.action(/yes/, deleteUserRobotYes.bind(service));
    scene.action(/no/, deleteUserRobotBack.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), deleteUserRobotBack.bind(service));
    scene.command("back", deleteUserRobotBack.bind(service));
    return scene;
}
