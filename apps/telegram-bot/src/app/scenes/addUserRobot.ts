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
import { UserExchangeAccountInfo } from "@cryptuoso/user-state";

function getUserExAccsMenu(ctx: any) {
    const {
        userExAccs
    }: {
        userExAccs: {
            id: string;
            name: string;
        }[];
    } = ctx.scene.state;
    return Extra.HTML().markup((m: any) => {
        const userExAccButtons = userExAccs.map(({ name, id }) => [
            m.callbackButton(`${name}`, JSON.stringify({ a: "userExAcc", p: id }), false)
        ]);
        const buttons = userExAccButtons;
        return m.inlineKeyboard([
            ...buttons,
            [m.callbackButton(ctx.i18n.t("keyboards.backKeyboard.back"), JSON.stringify({ a: "back" }), false)]
        ]);
    });
}

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

async function addUserRobotEnter(ctx: any) {
    try {
        if (ctx.scene.state.userExAccId) return addUserRobotSelectedAcc.call(this, ctx);
        const {
            robot: { exchange, code }
        }: {
            robot: Robot;
        } = ctx.scene.state;

        const userExAccs: UserExchangeAccountInfo[] = await this.getUserExchangeAccsByExchange(ctx);

        if (userExAccs && userExAccs.length) {
            ctx.scene.state.userExAccs = userExAccs;

            if (ctx.scene.state.edit) {
                ctx.scene.state.edit = false;
                return ctx.editMessageText(
                    ctx.i18n.t("scenes.addUserRobot.selectExAcc", {
                        exchange,
                        code
                    }),
                    getUserExAccsMenu(ctx)
                );
            }
            return ctx.editMessageText(
                ctx.i18n.t("scenes.addUserRobot.selectExAcc", {
                    exchange,
                    code
                }),
                getUserExAccsMenu(ctx)
            );
        } else {
            await ctx.reply(
                ctx.i18n.t("scenes.addUserRobot.noneExAccs", {
                    code,
                    exchange
                }),
                Extra.HTML()
            );
            ctx.scene.state.silent = true;
            return ctx.scene.enter(TelegramScene.ADD_USER_EX_ACC, {
                selectedExchange: exchange,
                prevScene: TelegramScene.ADD_USER_ROBOT,
                prevState: { ...ctx.scene.state, edit: false }
            });
        }
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function addUserRobotSelectedAcc(ctx: any) {
    try {
        if (!ctx.scene.state.userExAccId) {
            const { p: userExAccId } = JSON.parse(ctx.callbackQuery.data);
            ctx.scene.state.userExAccId = userExAccId;
        }

        const {
            robot
        }: {
            robot: Robot;
        } = ctx.scene.state;
        if (ctx.scene.state.edit) {
            ctx.scene.state.edit = false;
            return ctx.editMessageText(
                ctx.i18n.t("scenes.addUserRobot.chooseType", {
                    code: robot.code,
                    asset: robot.asset,
                    currency: robot.currency
                }),
                getChooseAmountTypeMenu(ctx)
            );
        }

        return ctx.reply(
            ctx.i18n.t("scenes.addUserRobot.chooseType", {
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

async function addUserRobotEnterVolume(ctx: any) {
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
        let minVolumeText;
        if (volumeType === VolumeSettingsType.assetStatic || volumeType === VolumeSettingsType.assetDynamicDelta) {
            asset = robot.asset;
            minVolumeText = ctx.i18n.t("scenes.addUserRobot.minVal", { minVolume: amount, asset });
        } else if (volumeType === VolumeSettingsType.currencyDynamic) {
            asset = robot.currency;
            minVolumeText = ctx.i18n.t("scenes.addUserRobot.minVal", { minVolume: amountUSD, asset });
        } else if (volumeType === VolumeSettingsType.balancePercent) {
            const {
                amounts: { balance, availableBalancePercent }
            }: {
                amounts: {
                    balance: number;
                    availableBalancePercent: number;
                };
            } = ctx.scene.state;
            asset = "%";
            const minPercent = Math.ceil((amountUSD / balance) * 100);
            minVolumeText = `${ctx.i18n.t("scenes.addUserRobot.avPerc", {
                volume: availableBalancePercent
            })}${ctx.i18n.t("scenes.addUserRobot.minVal", { minVolume: minPercent, asset })}`;
        } else throw new BaseError("Unknown amount type", { volumeType });
        if (ctx.scene.state.edit) {
            ctx.scene.state.edit = false;
            return ctx.editMessageText(
                ctx.i18n.t("scenes.addUserRobot.enterVolume", {
                    code: robot.code,
                    asset,
                    volume: minVolumeText
                }),
                Extra.HTML()
            );
        }
        return ctx.reply(
            ctx.i18n.t("scenes.addUserRobot.enterVolume", {
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

async function addUserRobotConfirm(ctx: any) {
    try {
        if (!ctx.scene.state.userExAccId) return addUserRobotEnter.call(this, ctx);

        const {
            robot,
            volumeType,
            market: {
                limits: {
                    userRobot: { min, max }
                }
            },

            userExAccId
        }: {
            robot: Robot;
            volumeType: VolumeSettingsType;
            market: {
                limits: UserMarketState["limits"];
                precision: UserMarketState["precision"];
            };

            userExAccId: string;
        } = ctx.scene.state;

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
                const {
                    amounts: { balance, availableBalancePercent }
                }: {
                    amounts: {
                        balance: number;
                        availableBalancePercent: number;
                    };
                } = ctx.scene.state;
                const volumeUSD = (volume / 100) * balance;
                checkBalancePercent(volume, availableBalancePercent, volumeUSD, min.amountUSD, max.amountUSD);
            } else throw new BaseError("Unknown amount type", { volumeType });
        } catch (e) {
            error = e.message;
        }

        let result;
        if (!error) {
            const params: {
                userExAccId: string;
                robotId: string;
                settings?: UserRobotSettings;
            } = {
                userExAccId,
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
                    userRobotCreate: { result }
                } = await this.gqlClient.request(
                    gql`
                        mutation UserRobotCreate($userExAccId: uuid!, $robotId: uuid!, $settings: UserRobotSettings!) {
                            userRobotCreate(robotId: $robotId, userExAccId: $userExAccId, settings: $settings) {
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
                ctx.i18n.t("scenes.addUserRobot.wrongVolume", {
                    code: robot.code,
                    error
                }),
                Extra.HTML()
            );
            ctx.scene.state.edit = false;
            return addUserRobotEnterVolume.call(this, ctx);
        }

        if (result) {
            const updatedRobot: Robot = await this.getUserRobot(ctx);
            ctx.scene.state.robot = updatedRobot;

            let asset;

            if (volumeType === VolumeSettingsType.assetStatic || volumeType === VolumeSettingsType.assetDynamicDelta) {
                asset = robot.asset;
            } else if (volumeType === VolumeSettingsType.currencyDynamic) {
                asset = robot.currency;
            } else if (volumeType === VolumeSettingsType.balancePercent) {
                asset = "%";
            }

            await ctx.reply(
                ctx.i18n.t("scenes.addUserRobot.success", {
                    code: robot.code,
                    volume,
                    asset
                }),
                Extra.HTML()
            );
            ctx.scene.state.silent = true;
            await ctx.scene.enter(TelegramScene.START_USER_ROBOT, {
                robot: ctx.scene.state.robot,
                prevState: ctx.scene.state.prevState
            });
        }
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function addUserRobotBack(ctx: any) {
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

export function addUserRobotScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.ADD_USER_ROBOT);
    scene.enter(addUserRobotEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.action(/userExAcc/, addUserRobotSelectedAcc.bind(service));
    scene.action(/volumeType/, addUserRobotEnterVolume.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), addUserRobotBack.bind(service));
    scene.command("back", addUserRobotBack.bind(service));
    scene.hears(/(.*?)/, addUserRobotConfirm.bind(service));
    return scene;
}
