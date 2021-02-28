import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { Robot, TelegramScene } from "../types";
import { addBaseActions, getConfirmMenu } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { gql } from "@cryptuoso/graphql-client";
import { GA } from "@cryptuoso/analytics";

async function unsubscribeSignalsEnter(ctx: any) {
    try {
        GA.view(ctx.session.user.id, TelegramScene.UNSUBSCRIBE_SIGNALS);
        const { robot }: { robot: Robot } = ctx.scene.state;

        return ctx.reply(
            ctx.i18n.t("scenes.unsubscribeSignals.confirm", {
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

async function unsubscribeSignalsYes(ctx: any) {
    try {
        const { robot } = ctx.scene.state;

        let error;
        let result;
        try {
            ({
                userSignalUnsubscribe: { result }
            } = await this.gqlClient.request(
                gql`
                    mutation UserSignalUnsubscribe($robotId: uuid!) {
                        userSignalUnsubscribe(robotId: $robotId) {
                            result
                        }
                    }
                `,
                { robotId: robot.id },
                ctx
            ));
        } catch (err) {
            error = err.message;
        }

        if (error) {
            await ctx.reply(
                ctx.i18n.t("scenes.unsubscribeSignals.failed", {
                    code: robot.code,
                    error
                }),
                Extra.HTML()
            );
            return unsubscribeSignalsBack.call(this, ctx);
        }

        if (result) {
            await ctx.reply(
                ctx.i18n.t("scenes.unsubscribeSignals.success", {
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

async function unsubscribeSignalsBack(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.ROBOT_SIGNAL, {
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

export function unsubscribeSignalsScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.UNSUBSCRIBE_SIGNALS);
    scene.enter(unsubscribeSignalsEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.action(/yes/, unsubscribeSignalsYes.bind(service));
    scene.action(/no/, unsubscribeSignalsBack.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), unsubscribeSignalsBack.bind(service));
    scene.command("back", unsubscribeSignalsBack.bind(service));
    return scene;
}
