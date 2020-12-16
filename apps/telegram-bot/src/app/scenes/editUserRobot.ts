import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { Robot, TelegramScene } from "../types";
import { addBaseActions } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { gql } from "@cryptuoso/graphql-client";
import {
    checkAssetStatic,
    checkBalancePercent,
    checkCurrencyDynamic,
    UserRobotSettings,
    VolumeSettingsType
} from "@cryptuoso/robot-settings";
import { UserMarketState } from "@cryptuoso/market";
import { BaseError } from "@cryptuoso/errors";
import { round } from "@cryptuoso/helpers";

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
            ],
            [
                m.callbackButton(
                    ctx.i18n.t("volumeType.assetDynamicDelta"),
                    JSON.stringify({ a: "volumeType", p: "assetDynamicDelta" }),
                    false
                )
            ],
            [
                m.callbackButton(
                    ctx.i18n.t("volumeType.balancePercent"),
                    JSON.stringify({ a: "volumeType", p: "balancePercent" }),
                    false
                )
            ]
        ]);
    });
}

async function editUserRobotEnter(ctx: any) {
    try {
        const {
            robot
        }: {
            robot: Robot;
        } = ctx.scene.state;
        if (ctx.scene.state.edit) {
            ctx.scene.state.edit = false;
            return ctx.reply(
                ctx.i18n.t("scenes.editUserRobot.chooseType", {
                    code: robot.code,
                    asset: robot.asset,
                    currency: robot.currency
                }),
                getChooseAmountTypeMenu(ctx)
            );
        }

        return ctx.editMessageText(
            ctx.i18n.t("scenes.editUserRobot.chooseType", {
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

async function editUserRobotEnterVolume(ctx: any) {
    try {
        if (!ctx.scene.state.volumeType) {
            const { p: volumeType }: { p: VolumeSettingsType } = JSON.parse(ctx.callbackQuery.data);
            ctx.scene.state.volumeType = volumeType;
        }
        if (ctx.scene.state.volumeType === VolumeSettingsType.balancePercent && !ctx.scene.state.amounts) {
            const { balance, availableBalancePercent } = await this.getUserAmounts(ctx);
            ctx.scene.state.amounts = { balance, availableBalancePercent };
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
                    userRobot: {
                        min: { amount, amountUSD }
                    }
                }
            },
            amounts: { balance, availableBalancePercent }
        }: {
            robot: Robot;
            volumeType: VolumeSettingsType;
            market: {
                limits: UserMarketState["limits"];
                precision: UserMarketState["precision"];
            };
            amounts: {
                balance: number;
                availableBalancePercent: number;
            };
        } = ctx.scene.state;

        let asset;
        let minVolumeText;
        if (volumeType === VolumeSettingsType.assetStatic || volumeType === VolumeSettingsType.assetDynamicDelta) {
            asset = robot.asset;
            minVolumeText = ctx.i18n.t("scenes.editUserRobot.minVal", { minVolume: amount, asset });
        } else if (volumeType === VolumeSettingsType.currencyDynamic) {
            asset = robot.currency;
            minVolumeText = ctx.i18n.t("scenes.editUserRobot.minVal", { minVolume: amountUSD, asset });
        } else if (volumeType === VolumeSettingsType.balancePercent) {
            asset = "%";
            const minPercent = Math.ceil((amountUSD / balance) * 100);
            let availablePercent = availableBalancePercent;
            if (robot.userRobot.settings.currentSettings.volumeType === VolumeSettingsType.balancePercent) {
                availablePercent = availableBalancePercent + robot.userRobot.settings.currentSettings.balancePercent;
            }
            minVolumeText = `${ctx.i18n.t("scenes.editUserRobot.avPerc", {
                volume: availablePercent
            })}${ctx.i18n.t("scenes.editUserRobot.minVal", { minVolume: minPercent, asset })}`;
        } else throw new BaseError("Unknown amount type", { volumeType });
        if (ctx.scene.state.edit) {
            ctx.scene.state.edit = false;
            return ctx.editMessageText(
                ctx.i18n.t("scenes.editUserRobot.enterVolume", {
                    code: robot.code,
                    asset,
                    volume: minVolumeText
                }),
                Extra.HTML()
            );
        }
        return ctx.reply(
            ctx.i18n.t("scenes.editUserRobot.enterVolume", {
                code: robot.code,
                asset,
                volume: minVolumeText
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

async function editUserRobotConfirm(ctx: any) {
    try {
        const {
            robot,
            volumeType,
            market: {
                limits: {
                    userRobot: { min, max }
                }
            },
            amounts: { balance, availableBalancePercent }
        }: {
            robot: Robot;
            volumeType: VolumeSettingsType;
            market: {
                limits: UserMarketState["limits"];
                precision: UserMarketState["precision"];
            };
            amounts: {
                balance: number;
                availableBalancePercent: number;
            };
        } = ctx.scene.state;

        const {
            userRobot: { id }
        } = robot;

        let volume: number;
        let error: string;
        try {
            volume = parseFloat(ctx.message.text);
            if (isNaN(volume)) error = "Volume is not a number";
            if (volumeType === VolumeSettingsType.assetStatic || volumeType === VolumeSettingsType.assetDynamicDelta) {
                checkAssetStatic(volume, min.amount, max.amount);
            } else if (volumeType === VolumeSettingsType.currencyDynamic) {
                checkCurrencyDynamic(volume, min.amountUSD, max.amountUSD);
            } else if (volumeType === VolumeSettingsType.balancePercent) {
                const volumeUSD = (volume / 100) * balance;
                let availablePercent = availableBalancePercent;
                if (robot.userRobot.settings.currentSettings.volumeType === VolumeSettingsType.balancePercent) {
                    availablePercent =
                        availableBalancePercent + robot.userRobot.settings.currentSettings.balancePercent;
                }
                checkBalancePercent(volume, availablePercent, volumeUSD, min.amountUSD, max.amountUSD);
            } else throw new BaseError("Unknown amount type", { volumeType });
        } catch (e) {
            error = e.message;
        }

        let result;
        if (!error) {
            const params: {
                id: string;
                settings?: UserRobotSettings;
            } = {
                id
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
            } else if (volumeType === VolumeSettingsType.assetDynamicDelta) {
                params.settings = {
                    volumeType,
                    initialVolume: volume
                };
            } else if (volumeType === VolumeSettingsType.balancePercent) {
                params.settings = {
                    volumeType,
                    balancePercent: volume
                };
            }
            try {
                ({
                    userRobotEdit: { result }
                } = await this.gqlClient.request(
                    gql`
                        mutation UserRobotEdit($id: uuid!, $settings: UserRobotSettings!) {
                            userRobotEdit(id: $id, settings: $settings) {
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
                ctx.i18n.t("scenes.editUserRobot.wrongVolume", {
                    code: robot.code,
                    error
                }),
                Extra.HTML()
            );
            ctx.scene.state.edit = false;
            return editUserRobotEnter.call(this, ctx);
        }

        if (result) {
            let asset;

            if (volumeType === VolumeSettingsType.assetStatic || volumeType === VolumeSettingsType.assetDynamicDelta) {
                asset = robot.asset;
            } else if (volumeType === VolumeSettingsType.currencyDynamic) {
                asset = robot.currency;
            } else if (volumeType === VolumeSettingsType.balancePercent) {
                asset = "%";
            }

            await ctx.reply(
                ctx.i18n.t("scenes.editUserRobot.success", {
                    code: robot.code,
                    volume,
                    asset
                }),
                Extra.HTML()
            );
        }
        await editUserRobotBack.call(this, ctx);
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function editUserRobotBack(ctx: any) {
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

export function editUserRobotScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.EDIT_USER_ROBOT);
    scene.enter(editUserRobotEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.action(/volumeType/, editUserRobotEnterVolume.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), editUserRobotBack.bind(service));
    scene.command("back", editUserRobotBack.bind(service));
    scene.hears(/(.*?)/, editUserRobotConfirm.bind(service));
    return scene;
}
