import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { IUserSub, TelegramScene } from "../types";
import { addBaseActions, getConfirmMenu } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { gql } from "@cryptuoso/graphql-client";

async function cancelUserSubEnter(ctx: any) {
    try {
        const { userSub }: { userSub: IUserSub } = ctx.scene.state;

        return ctx.reply(
            ctx.i18n.t("scenes.cancelUserSub.confirm", {
                name: userSub.subscription.name
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

async function cancelUserSubYes(ctx: any) {
    try {
        const { userSub }: { userSub: IUserSub } = ctx.scene.state;

        let error;
        let result;
        try {
            ({
                cancelUserSub: { result }
            } = await this.gqlClient.request(
                gql`
                    mutation CancelUserSub($id: uuid!) {
                        cancelUserSub(id: $id) {
                            result
                        }
                    }
                `,
                { id: userSub.id },
                ctx
            ));
        } catch (err) {
            error = err.message;
        }

        if (error) {
            await ctx.reply(
                ctx.i18n.t("scenes.cancelUserSub.failed", {
                    name: userSub.subscription.name,
                    error
                }),
                Extra.HTML()
            );
            return cancelUserSubBack.call(this, ctx);
        }

        if (result) {
            await ctx.reply(
                ctx.i18n.t("scenes.cancelUserSub.success", {
                    name: userSub.subscription.name
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

async function cancelUserSubBack(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.USER_SUB, {
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

export function cancelUserSubScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.CANCEL_USER_SUB);
    scene.enter(cancelUserSubEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.action(/yes/, cancelUserSubYes.bind(service));
    scene.action(/no/, cancelUserSubBack.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), cancelUserSubBack.bind(service));
    scene.command("back", cancelUserSubBack.bind(service));
    return scene;
}
