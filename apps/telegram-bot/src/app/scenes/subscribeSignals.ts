import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { Robot, TelegramScene } from "../types";
import { addBaseActions } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { gql } from "@cryptuoso/graphql-client";

import {
    checkAssetStatic,
    checkCurrencyDynamic,
    UserSignalSettings,
    VolumeSettingsType
} from "@cryptuoso/robot-settings";
import { BaseError } from "@cryptuoso/errors";
import { UserMarketState } from "@cryptuoso/market";
import { GA } from "@cryptuoso/analytics";

function getChooseAmountTypeMenu(ctx: any) {
    return Extra.HTML().markup((m: any) => {
        return m.inlineKeyboard([
            [
                m.callbackButton(
                    ctx.i18n.t("volumeType.assetStatic"),
                    JSON.stringify({ a: "volumeType", p: "assetStatic" }),
                    false
                )
            ],
            [
                m.callbackButton(
                    ctx.i18n.t("volumeType.currencyDynamic"),
                    JSON.stringify({ a: "volumeType", p: "currencyDynamic" }),
                    false
                )
            ]
        ]);
    });
}

async function subscribeSignalsEnter(ctx: any) {
    try {
        GA.view(ctx.session.user.id, TelegramScene.SUBSCRIBE_SIGNALS);
        const { robot } = ctx.scene.state;
        ctx.scene.state.edit = true;
        return ctx.reply(
            ctx.i18n.t("scenes.subscribeSignals.chooseType", {
                code: robot.code,
                asset: robot.asset,
                currency: robot.currency
            }),
            getChooseAmountTypeMenu(ctx)
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function subscribeSignalsEnterVolume(ctx: any) {
    try {
        if (!ctx.scene.state.volumeType) {
            const { p: volumeType }: { p: VolumeSettingsType } = JSON.parse(ctx.callbackQuery.data);
            ctx.scene.state.volumeType = volumeType;
        }
        if (!ctx.scene.state.market) {
            const market = await this.getUserMarket(ctx);
            ctx.scene.state.market = market;
        }

        const {
            robot,
            volumeType,
            market: {
                limits: {
                    userSignal: {
                        min: { amount, amountUSD }
                    }
                }
            }
        }: {
            robot: Robot;
            volumeType: VolumeSettingsType;
            market: {
                limits: UserMarketState["limits"];
                precision: UserMarketState["precision"];
            };
        } = ctx.scene.state;

        let asset;
        let minVolume;
        if (volumeType === VolumeSettingsType.assetStatic) {
            asset = robot.asset;
            minVolume = amount;
        } else if (volumeType === VolumeSettingsType.currencyDynamic) {
            asset = robot.currency;
            minVolume = amountUSD;
        } else throw new BaseError("Unknown amount type", { volumeType });
        if (ctx.scene.state.edit) {
            ctx.scene.state.edit = false;
            return ctx.editMessageText(
                ctx.i18n.t("scenes.subscribeSignals.enterVolume", {
                    code: robot.code,
                    asset,
                    minVolume
                }),
                Extra.HTML()
            );
        }
        return ctx.reply(
            ctx.i18n.t("scenes.subscribeSignals.enterVolume", {
                code: robot.code,
                asset,
                minVolume
            }),
            Extra.HTML()
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function subscribeSignalsConfirm(ctx: any) {
    try {
        const {
            volumeType,
            robot,
            market: {
                limits: {
                    userSignal: { min, max }
                }
            }
        }: {
            robot: Robot;
            volumeType: VolumeSettingsType;
            market: {
                limits: UserMarketState["limits"];
                precision: UserMarketState["precision"];
            };
        } = ctx.scene.state;

        let volume: number;
        let error: string;
        try {
            volume = parseFloat(ctx.message.text);
            if (isNaN(volume)) error = "Volume is not a number";
            if (volumeType === VolumeSettingsType.assetStatic) {
                checkAssetStatic(volume, min.amount, max.amount);
            } else if (volumeType === VolumeSettingsType.currencyDynamic) {
                checkCurrencyDynamic(volume, min.amountUSD, max.amountUSD);
            } else throw new BaseError("Unknown amount type", { volumeType });
        } catch (e) {
            error = e.message;
        }
        let result;
        if (!error) {
            const params: {
                robotId: string;
                settings?: UserSignalSettings;
            } = {
                robotId: robot.id
            };

            if (volumeType === VolumeSettingsType.assetStatic) {
                params.settings = {
                    volumeType,
                    volume
                };
            } else if (volumeType === VolumeSettingsType.currencyDynamic) {
                params.settings = {
                    volumeType,
                    volumeInCurrency: volume
                };
            }
            try {
                ({
                    userSignalSubscribe: { result }
                } = await this.gqlClient.request(
                    gql`
                        mutation userSignalSubscribe($robotId: uuid!, $settings: UserSignalSettings!) {
                            userSignalSubscribe(robotId: $robotId, settings: $settings) {
                                result
                            }
                        }
                    `,
                    params,
                    ctx
                ));
            } catch (err) {
                error = err.message;
            }
        }

        if (error) {
            await ctx.reply(
                ctx.i18n.t("scenes.subscribeSignals.wrongVolume", {
                    code: robot.code,
                    error
                }),
                Extra.HTML()
            );
            return subscribeSignalsEnterVolume.call(this, ctx);
        }

        if (result) {
            let asset;

            if (volumeType === VolumeSettingsType.assetStatic) {
                asset = robot.asset;
            } else if (volumeType === VolumeSettingsType.currencyDynamic) {
                asset = robot.currency;
            }
            await ctx.reply(
                ctx.i18n.t("scenes.subscribeSignals.subscribedSignals", {
                    code: robot.code,
                    volume,
                    asset
                }),
                Extra.HTML()
            );
        }
        return subscribeSignalsBack.call(this, ctx);
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function subscribeSignalsBack(ctx: any) {
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

export function subscribeSignalsScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.SUBSCRIBE_SIGNALS);
    scene.enter(subscribeSignalsEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.action(/volumeType/, subscribeSignalsEnterVolume.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), subscribeSignalsBack.bind(service));
    scene.command("back", subscribeSignalsBack.bind(service));
    scene.hears(/(.*?)/, subscribeSignalsConfirm.bind(service));
    return scene;
}
