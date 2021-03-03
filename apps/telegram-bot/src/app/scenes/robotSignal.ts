import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { ClosedPosition, OpenPosition, Robot, TelegramScene } from "../types";
import { addBaseActions } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { round, sortAsc } from "@cryptuoso/helpers";
import dayjs from "@cryptuoso/dayjs";
import { getStatisticsText, getVolumeText } from "../helpers";
import { GA } from "@cryptuoso/analytics";

function getSignalRobotMenu(ctx: any) {
    const subscribed = !!ctx.scene.state.robot.userSignal;

    return Extra.HTML().markup((m: any) => {
        const subscribeToggleButton = !subscribed
            ? m.callbackButton(
                  ctx.i18n.t("scenes.robotSignal.subscribeSignals"),
                  JSON.stringify({ a: "subscribe" }),
                  false
              )
            : m.callbackButton(
                  ctx.i18n.t("scenes.robotSignal.unsubscribeSignals"),
                  JSON.stringify({ a: "unsubscribe" }),
                  false
              );

        return m.inlineKeyboard([
            [m.callbackButton(ctx.i18n.t("robot.menuInfo"), JSON.stringify({ a: "info" }), false)],
            [m.callbackButton(ctx.i18n.t("robot.menuMyStats"), JSON.stringify({ a: "myStat" }), !subscribed)],
            [m.callbackButton(ctx.i18n.t("robot.menuPublStats"), JSON.stringify({ a: "pStat" }), false)],
            [m.callbackButton(ctx.i18n.t("robot.menuPositions"), JSON.stringify({ a: "pos" }), false)],
            [m.callbackButton(ctx.i18n.t("scenes.robotSignal.edit"), JSON.stringify({ a: "edit" }), !subscribed)],
            [subscribeToggleButton],
            [m.callbackButton(ctx.i18n.t("keyboards.backKeyboard.back"), JSON.stringify({ a: "back" }), false)]
        ]);
    });
}

async function robotSignalInfo(ctx: any) {
    try {
        GA.view(ctx.session.user.id, TelegramScene.ROBOT_SIGNAL);
        if (ctx.scene.state.edit && ctx.scene.state.page && ctx.scene.state.page === "info") {
            if (
                ctx.scene.state.robot &&
                dayjs.utc().diff(dayjs.utc(ctx.scene.state.robot.lastInfoUpdatedAt), "second") < 5
            )
                return;
        }
        ctx.scene.state.page = "info";

        const robot: Robot = await this.getSignalRobot(ctx);
        ctx.scene.state.robot = robot;

        let subscribedAtText = "";

        if (robot.userSignal) {
            const { subscribedAt } = robot.userSignal;
            subscribedAtText = ctx.i18n.t("robot.subscribedAt", {
                subscribedAt: dayjs.utc(subscribedAt).format("YYYY-MM-DD HH:mm UTC")
            });
        }

        let volumeText = "";

        if (robot.userSignal) {
            if (robot.userSignal.settings)
                volumeText = getVolumeText(ctx, robot.userSignal.settings.currentSettings, robot.asset);
        } else {
            volumeText = getVolumeText(ctx, robot.settings.currentSettings, robot.asset);
        }

        let profitText = "";
        let netProfit = null;
        if (robot.userSignal) {
            if (robot.userSignal.stats) ({ netProfit } = robot.userSignal.stats);
            else netProfit = 0;
        } else if (robot.stats) ({ netProfit } = robot.stats);

        if (netProfit !== null && netProfit !== undefined) {
            profitText = ctx.i18n.t("robot.profit", {
                profit: netProfit > 0 ? `+${netProfit}` : netProfit
            });
        }

        let signalsText = "";
        let activeSignals;
        if (robot.userSignal) ({ activeSignals } = robot.userSignal);
        else ({ activeSignals } = robot);

        if (activeSignals.length > 0) {
            activeSignals.forEach((signal) => {
                const actionText = ctx.i18n.t(`tradeAction.${signal.action}`);
                const orderTypeText = ctx.i18n.t(`orderType.${signal.orderType}`);
                const text = ctx.i18n.t("robot.signal", {
                    code: signal.code,
                    timestamp: dayjs.utc(signal.timestamp).format("YYYY-MM-DD HH:mm UTC"),
                    action: actionText,
                    orderType: orderTypeText,
                    price: +signal.price
                });
                signalsText = `${signalsText}\n${text}`;
            });
        }
        if (signalsText !== "") signalsText = ctx.i18n.t("robot.signals", { signals: signalsText });

        const updatedAtText = ctx.i18n.t("robot.lastInfoUpdatedAt", {
            lastInfoUpdatedAt: ctx.scene.state.robot.lastInfoUpdatedAt
        });

        const message = `${ctx.i18n.t("robot.info", {
            code: robot.code,
            subscribed: robot.userSignal ? "✅" : "",
            description: robot.strategy.description,
            signalsCount: round(1440 / robot.timeframe)
        })}${subscribedAtText}${profitText}${volumeText}${signalsText}${updatedAtText}`;

        if (ctx.scene.state.edit) {
            ctx.scene.state.edit = false;
            return ctx.editMessageText(message, getSignalRobotMenu(ctx));
        }
        return ctx.reply(message, getSignalRobotMenu(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        await ctx.scene.leave();
    }
}

async function robotSignalPublicStats(ctx: any) {
    try {
        if (ctx.scene.state.page && ctx.scene.state.page === "publStats") {
            if (
                ctx.scene.state.robot &&
                dayjs.utc().diff(dayjs.utc(ctx.scene.state.robot.lastInfoUpdatedAt), "second") < 5
            )
                return;
            const robot: Robot = await this.getSignalRobot(ctx);
            ctx.scene.state.robot = robot;
        }
        ctx.scene.state.page = "publStats";

        const { robot }: { robot: Robot } = ctx.scene.state;
        const updatedAtText = ctx.i18n.t("robot.lastInfoUpdatedAt", {
            lastInfoUpdatedAt: robot.lastInfoUpdatedAt
        });

        let message;

        if (robot.stats && robot.stats.tradesCount)
            message = getStatisticsText(ctx, robot.stats, robot.settings.currentSettings, robot.asset);
        else message = ctx.i18n.t("robot.statsNone");
        return ctx.editMessageText(
            ctx.i18n.t("robot.name", {
                code: robot.code,
                subscribed: robot.userSignal ? "✅" : ""
            }) + `${ctx.i18n.t("robot.menuPublStats")}\n\n${message}${updatedAtText}`,
            getSignalRobotMenu(ctx)
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        await ctx.scene.leave();
    }
}

async function robotSignalMyStats(ctx: any) {
    try {
        if (ctx.scene.state.page && ctx.scene.state.page === "myStats") {
            if (
                ctx.scene.state.robot &&
                dayjs.utc().diff(dayjs.utc(ctx.scene.state.robot.lastInfoUpdatedAt), "second") < 5
            )
                return;
            const robot: Robot = await this.getSignalRobot(ctx);
            ctx.scene.state.robot = robot;
        }
        ctx.scene.state.page = "myStats";
        const { robot }: { robot: Robot } = ctx.scene.state;

        const updatedAtText = ctx.i18n.t("robot.lastInfoUpdatedAt", {
            lastInfoUpdatedAt: robot.lastInfoUpdatedAt
        });
        let message;
        if (robot.userSignal && robot.userSignal.stats && robot.userSignal.stats.tradesCount)
            message = getStatisticsText(
                ctx,
                robot.userSignal.stats,
                robot.userSignal.settings.currentSettings,
                robot.asset
            );
        else message = ctx.i18n.t("robot.statsNone");
        return ctx.editMessageText(
            ctx.i18n.t("robot.name", {
                code: robot.code,
                subscribed: robot.userSignal ? "✅" : ""
            }) + `${ctx.i18n.t("robot.menuMyStats")}\n\n${message}${updatedAtText}`,
            getSignalRobotMenu(ctx)
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        await ctx.scene.leave();
    }
}

async function robotSignalPositions(ctx: any) {
    try {
        if (ctx.scene.state.page && ctx.scene.state.page === "pos") {
            if (
                ctx.scene.state.robot &&
                dayjs.utc().diff(dayjs.utc(ctx.scene.state.robot.lastInfoUpdatedAt), "second") < 5
            )
                return;

            const robot: Robot = await this.getSignalRobot(ctx);
            ctx.scene.state.robot = robot;
        }
        ctx.scene.state.page = "pos";
        const {
            robot
        }: {
            robot: Robot;
        } = ctx.scene.state;
        const subscribed = !!robot.userSignal;
        let openPositions: OpenPosition[] = [];
        let closedPositions: ClosedPosition[] = [];
        if (subscribed) {
            ({ openPositions, closedPositions } = robot.userSignal);
        } else {
            ({ openPositions, closedPositions } = robot);
        }

        let openPositionsText = "";
        if (openPositions && Array.isArray(openPositions) && openPositions.length > 0) {
            openPositions.forEach((pos: OpenPosition) => {
                const posText = ctx.i18n.t("robot.positionOpen", {
                    ...pos,
                    entryAction: ctx.i18n.t(`tradeAction.${pos.entryAction}`),
                    entryDate: dayjs.utc(pos.entryDate).format("YYYY-MM-DD HH:mm UTC")
                });

                openPositionsText = `${openPositionsText}\n\n${posText}`;
            });
            openPositionsText = ctx.i18n.t("robot.positionsOpen", {
                openPositions: openPositionsText
            });
        }

        let closedPositionsText = "";
        if (closedPositions && Array.isArray(closedPositions) && closedPositions.length > 0) {
            closedPositions
                .sort((a, b) => sortAsc(dayjs.utc(a.entryDate).valueOf(), dayjs.utc(b.entryDate).valueOf()))
                .forEach((pos: ClosedPosition) => {
                    const posText = ctx.i18n.t("robot.positionClosed", {
                        ...pos,
                        entryDate: dayjs.utc(pos.entryDate).format("YYYY-MM-DD HH:mm UTC"),
                        exitDate: dayjs.utc(pos.exitDate).format("YYYY-MM-DD HH:mm UTC"),
                        entryAction: ctx.i18n.t(`tradeAction.${pos.entryAction}`),
                        exitAction: ctx.i18n.t(`tradeAction.${pos.exitAction}`)
                    });
                    closedPositionsText = `${closedPositionsText}\n\n${posText}`;
                });
            closedPositionsText = ctx.i18n.t("robot.positionsClosed", {
                closedPositions: closedPositionsText
            });
        }
        const updatedAtText = ctx.i18n.t("robot.lastInfoUpdatedAt", {
            lastInfoUpdatedAt: ctx.scene.state.robot.lastInfoUpdatedAt
        });
        const message =
            openPositionsText !== "" || closedPositionsText !== ""
                ? `${closedPositionsText}${openPositionsText}`
                : ctx.i18n.t("robot.positionsNone");
        return ctx.editMessageText(
            `${ctx.i18n.t("robot.name", {
                code: robot.code,
                subscribed: subscribed ? "✅" : ""
            })}${message}${updatedAtText}`,
            getSignalRobotMenu(ctx)
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        await ctx.scene.leave();
    }
}

async function robotSignalSubscribe(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.SUBSCRIBE_SIGNALS, {
            robot: ctx.scene.state.robot,
            prevState: {
                ...ctx.scene.state,
                page: null,
                silent: false,
                reload: true,
                edit: false
            }
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        await ctx.scene.leave();
    }
}

async function robotSignalEdit(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.EDIT_SIGNALS, {
            robot: ctx.scene.state.robot,
            prevState: {
                ...ctx.scene.state,
                page: null,
                silent: false,
                reload: true,
                edit: false
            }
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        await ctx.scene.leave();
    }
}

async function robotSignalUnsubscribe(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.UNSUBSCRIBE_SIGNALS, {
            robot: ctx.scene.state.robot,
            prevState: {
                ...ctx.scene.state,
                page: null,
                silent: false,
                reload: true,
                edit: false
            }
        });
    } catch (e) {
        this.log.error(e);
        ctx.scene.state.silent = false;
        await ctx.reply(ctx.i18n.t("failed"));
        await ctx.scene.leave();
    }
}

async function robotSignalBack(ctx: any) {
    try {
        if (!ctx.scene.state.prevScene) {
            ctx.scene.state.silent = false;
            return ctx.scene.leave();
        }
        ctx.scene.state.silent = true;
        await ctx.scene.enter(ctx.scene.state.prevScene, {
            ...ctx.scene.state.prevState,
            reload: true
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function robotSignalBackEdit(ctx: any) {
    try {
        if (!ctx.scene.state.prevScene) {
            ctx.scene.state.silent = false;
            return ctx.scene.leave();
        }
        ctx.scene.state.silent = true;
        await ctx.scene.enter(ctx.scene.state.prevScene, {
            ...ctx.scene.state.prevState,
            edit: true,
            reload: true
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export function robotSignalScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.ROBOT_SIGNAL);
    scene.enter(robotSignalInfo.bind(service));
    addBaseActions(scene, service, false);
    scene.action(/info/, robotSignalInfo.bind(service));
    scene.action(/pStat/, robotSignalPublicStats.bind(service));
    scene.action(/myStat/, robotSignalMyStats.bind(service));
    scene.action(/pos/, robotSignalPositions.bind(service));
    scene.action(/unsubscribe/, robotSignalUnsubscribe.bind(service));
    scene.action(/subscribe/, robotSignalSubscribe.bind(service));
    scene.action(/edit/, robotSignalEdit.bind(service));
    scene.action(/back/, robotSignalBackEdit.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), robotSignalBack.bind(service));
    scene.command("back", robotSignalBack.bind(service));
    return scene;
}
