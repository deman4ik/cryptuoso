import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { TelegramScene } from "../types";
import { addBaseActions } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { UserExchangeAccountInfo, UserExchangeAccStatus } from "@cryptuoso/user-state";
import { gql } from "@cryptuoso/graphql-client";

function getUserExAccMenu(ctx: any) {
    const { status }: UserExchangeAccountInfo = ctx.scene.state.userExAcc;
    return Extra.HTML().markup((m: any) => {
        const buttons = [
            [
                m.callbackButton(
                    ctx.i18n.t("scenes.userExAcc.edit"),
                    JSON.stringify({ a: "edit" }),
                    status === UserExchangeAccStatus.enabled
                )
            ],
            [m.callbackButton(ctx.i18n.t("scenes.userExAcc.delete"), JSON.stringify({ a: "delete" }), false)],
            [m.callbackButton(ctx.i18n.t("keyboards.backKeyboard.back"), JSON.stringify({ a: "back" }), false)]
        ];
        return m.inlineKeyboard(buttons);
    });
}

async function userExAccEnter(ctx: any) {
    try {
        const { name, status }: UserExchangeAccountInfo = ctx.scene.state.userExAcc;

        if (ctx.scene.state.edit) {
            ctx.scene.state.edit = false;

            return ctx.editMessageText(
                ctx.i18n.t("scenes.userExAcc.info", {
                    name,
                    status
                }),
                getUserExAccMenu(ctx)
            );
        }
        return ctx.reply(
            ctx.i18n.t("scenes.userExAcc.info", {
                name,
                status
            }),
            getUserExAccMenu(ctx)
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function userExAccEdit(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.EDIT_USER_EX_ACC, {
            userExAcc: ctx.scene.state.userExAcc,
            prevScene: TelegramScene.USER_EXCHANGE_ACC,
            prevState: ctx.scene.state
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function userExAccDelete(ctx: any) {
    try {
        const { id, name }: UserExchangeAccountInfo = ctx.scene.state.userExAcc;

        let error: string;
        let result;
        try {
            ({
                setNotificationSettings: { result }
            } = await this.gqlClient.request(
                gql`
                    mutation UserExchangeAccDelete($id: uuid!) {
                        userExchangeAccDelete(id: $id) {
                            result
                        }
                    }
                `,
                { id }
            ));
        } catch (err) {
            error = err.message;
        }
        if (error) {
            await ctx.reply(
                ctx.i18n.t("scenes.userExAcc.deleteFailed", {
                    name,
                    error: error || ctx.i18n.t("unknownError")
                }),
                Extra.HTML()
            );

            await userExAccEnter.call(this, ctx);
        }
        if (result) {
            await ctx.editMessageText(
                ctx.i18n.t("scenes.userExAcc.deleteSuccess", {
                    name
                }),
                Extra.HTML()
            );

            await userExAccBack.call(this, ctx);
        }
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function userExAccBack(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.USER_EXCHANGE_ACCS, {
            silent: false
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function userExAccBackEdit(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.USER_EXCHANGE_ACCS, {
            silent: false,
            edit: true
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export function userExAccScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.USER_EXCHANGE_ACC);
    scene.enter(userExAccEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.action(/edit/, userExAccEdit.bind(service));
    scene.action(/delete/, userExAccDelete.bind(service));
    scene.action(/back/, userExAccBackEdit.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), userExAccBack.bind(service));
    scene.command("back", userExAccBack.bind(service));
    return scene;
}
