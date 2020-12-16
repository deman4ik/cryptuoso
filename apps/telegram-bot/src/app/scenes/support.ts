import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { TelegramScene } from "../types";
import { addBaseActions } from "./default";
import { gql } from "@cryptuoso/graphql-client";
import { getBackKeyboard } from "../keyboard";
import { sleep } from "@cryptuoso/helpers";

async function supportEnter(ctx: any) {
    try {
        const message = `${ctx.i18n.t("scenes.support.info1")}${ctx.i18n.t("scenes.support.info2")}${ctx.i18n.t(
            "scenes.support.info3"
        )}${ctx.i18n.t("scenes.support.info4")}`;
        await ctx.reply(ctx.i18n.t("keyboards.mainKeyboard.support"), getBackKeyboard(ctx));
        await sleep(100);
        await ctx.reply(message, Extra.HTML());
    } catch (e) {
        this.logger.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function supportMessage(ctx: any) {
    try {
        const message = ctx.message.text;

        const {
            supportMessage: { result }
        } = await this.gqlClient.request(
            gql`
                mutation SupportMessage($message: String!) {
                    supportMessage(message: $message) {
                        result
                    }
                }
            `,
            {
                message
            },
            ctx
        );

        if (result) await ctx.reply(ctx.i18n.t("scenes.support.success"), Extra.HTML());
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    } catch (e) {
        this.logger.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export function supportScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.SUPPORT);
    scene.enter(supportEnter.bind(service));
    addBaseActions(scene, service);
    scene.hears(/(.*?)/, supportMessage.bind(service));
    return scene;
}
