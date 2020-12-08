import { BaseService } from "@cryptuoso/service";
import { BaseScene, Extra } from "telegraf";
import { ClosedPosition, OpenPosition, Robot, TelegramScene } from "../types";
import { addBaseActions } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { gql } from "@cryptuoso/graphql-client";
import { round, sortAsc } from "@cryptuoso/helpers";
import dayjs from "@cryptuoso/dayjs";
import { getStatisticsText, getVolumeText } from "../helpers";
import { UserRobotStatus } from "@cryptuoso/user-robot-state";

function getUserRobotMenu(ctx: any) {
    const { robot }: { robot: Robot } = ctx.scene.state;
    const userRobot = robot.userRobot;
    const added = !!userRobot;
    let status: UserRobotStatus = UserRobotStatus.stopped;
    if (added) {
        ({ status } = userRobot);
    }

    return Extra.HTML().markup((m: any) => {
        return m.inlineKeyboard([
            [m.callbackButton(ctx.i18n.t("robot.menuInfo"), JSON.stringify({ a: "info" }), false)],
            [m.callbackButton(ctx.i18n.t("robot.menuMyStats"), JSON.stringify({ a: "myStat" }), !added)],
            [m.callbackButton(ctx.i18n.t("robot.menuPublStats"), JSON.stringify({ a: "pStat" }), false)],
            [m.callbackButton(ctx.i18n.t("robot.menuPositions"), JSON.stringify({ a: "pos" }), !added)],
            [m.callbackButton(ctx.i18n.t("scenes.userRobot.edit"), JSON.stringify({ a: "edit" }), !added)],
            [
                m.callbackButton(
                    ctx.i18n.t("scenes.userRobot.start"),
                    JSON.stringify({ a: "start" }),
                    !added || ![UserRobotStatus.stopped].includes(status)
                )
            ],
            [
                m.callbackButton(
                    ctx.i18n.t("scenes.userRobot.stop"),
                    JSON.stringify({ a: "stop" }),
                    !added || ![UserRobotStatus.started, UserRobotStatus.starting].includes(status)
                )
            ],
            [m.callbackButton(ctx.i18n.t("scenes.userRobot.add"), JSON.stringify({ a: "add" }), added)],
            [
                m.callbackButton(
                    ctx.i18n.t("scenes.userRobot.delete"),
                    JSON.stringify({ a: "delete" }),
                    !added || status !== UserRobotStatus.stopped
                )
            ],
            [m.callbackButton(ctx.i18n.t("keyboards.backKeyboard.back"), JSON.stringify({ a: "back" }), false)]
        ]);
    });
}

async function userRobotInfo(ctx: any) {
    try {
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

        const { userRobot } = robot;

        let userExAccText = "";
        if (userRobot) {
            userExAccText = ctx.i18n.t("robot.userExAcc", {
                name: userRobot.userExAcc.userExAccName
            });
        }

        let statusText = "";
        if (userRobot) {
            const { status, startedAt, stoppedAt } = userRobot;

            statusText = ctx.i18n.t("robot.status", {
                status: ctx.i18n.t(`status.${status}`)
            });
            if (status === UserRobotStatus.started && startedAt) {
                statusText = `${statusText}${ctx.i18n.t("robot.startedAt", {
                    startedAt: dayjs.utc(startedAt).format("YYYY-MM-DD HH:mm UTC")
                })}`;
            }
            if (status === UserRobotStatus.stopped && stoppedAt) {
                statusText = `${statusText}${ctx.i18n.t("robot.stoppedAt", {
                    stoppedAt: dayjs.utc(stoppedAt).format("YYYY-MM-DD HH:mm UTC")
                })}`;
            }
        }

        let volumeText = "";

        if (userRobot) {
            ({ volumeText } = getVolumeText(ctx, robot.settings.currentSettings, robot.asset));
        } else {
            ({ volumeText } = getVolumeText(ctx, robot.userRobot.settings.currentSettings, robot.asset));
        }

        let profitText = "";
        let netProfit = null;
        if (userRobot) ({ netProfit } = userRobot.stats);
        else ({ netProfit } = robot.stats);

        if (netProfit !== null && netProfit !== undefined) {
            profitText = ctx.i18n.t("robot.profit", {
                profit: netProfit > 0 ? `+${netProfit}` : netProfit
            });
        }

        const updatedAtText = ctx.i18n.t("robot.lastInfoUpdatedAt", {
            lastInfoUpdatedAt: ctx.scene.state.lastInfoUpdatedAt
        });

        const message = `${ctx.i18n.t("robot.name", {
            code: robot.code,
            subscribed: userRobot ? "✅" : ""
        })}${userExAccText}${statusText}${profitText}${volumeText}${updatedAtText}`;

        if (ctx.scene.state.edit) {
            ctx.scene.state.edit = false;
            return ctx.editMessageText(message, getUserRobotMenu(ctx));
        }
        return ctx.reply(message, getUserRobotMenu(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function userRobotPublicStats(ctx: any) {
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

        const { robot } = ctx.scene.state;
        const { userRobot } = robot;

        const updatedAtText = ctx.i18n.t("robot.lastInfoUpdatedAt", {
            lastInfoUpdatedAt: robot.lastInfoUpdatedAt
        });

        let message;

        if (robot.stats.tradesCount)
            message = getStatisticsText(ctx, robot.stats, robot.settings.currentSettings, robot.asset);
        else message = ctx.i18n.t("robot.statsNone");

        return ctx.editMessageText(
            ctx.i18n.t("robot.name", {
                code: robot.code,
                subscribed: userRobot ? "✅" : ""
            }) + `${ctx.i18n.t("robot.menuPublStats")}\n\n${message}\n\n${updatedAtText}`,
            getUserRobotMenu(ctx)
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function userRobotMyStats(ctx: any) {
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
        const { robot } = ctx.scene.state;
        const { userRobot } = robot;

        const updatedAtText = ctx.i18n.t("robot.lastInfoUpdatedAt", {
            lastInfoUpdatedAt: robot.lastInfoUpdatedAt
        });

        let message;
        if (userRobot && userRobot.stats.tradesCount)
            message = getStatisticsText(ctx, userRobot.stats, userRobot.settings.currentSettings, robot.asset);
        else message = ctx.i18n.t("robot.statsNone");
        return ctx.editMessageText(
            ctx.i18n.t("robot.name", {
                code: robot.code,
                subscribed: userRobot ? "✅" : ""
            }) + `${ctx.i18n.t("robot.menuMyStats")}\n\n${message}\n\n${updatedAtText}`,
            getUserRobotMenu(ctx)
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function userRobotPositions(ctx: any) {
    try {
        if (ctx.scene.state.page && ctx.scene.state.page === "pos") {
            if (
                ctx.scene.state.lastInfoUpdatedAt &&
                dayjs.utc().diff(dayjs.utc(ctx.scene.state.lastInfoUpdatedAt), "second") < 5
            )
                return;
            const robot: Robot = await this.getSignalRobot(ctx);
            ctx.scene.state.robot = robot;
        }
        ctx.scene.state.page = "pos";
        const { robot } = ctx.scene.state;
        const { userRobot } = robot;

        const { openPositions, closedPositions } = userRobot;

        let openPositionsText = "";
        if (openPositions && Array.isArray(openPositions) && openPositions.length > 0) {
            openPositions.forEach((pos: OpenPosition) => {
                const posText = ctx.i18n.t("robot.positionOpen", {
                    ...pos,
                    entryAction: ctx.i18n.t(`tradeAction.${pos.entryAction}`),
                    entryDate: dayjs.utc(pos.entryDate).format("YYYY-MM-DD HH:mm UTC")
                });
                openPositionsText = `${openPositionsText}\n\n${posText}\n`;
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
            lastInfoUpdatedAt: ctx.scene.state.lastInfoUpdatedAt
        });

        const message =
            openPositionsText !== "" || closedPositionsText !== ""
                ? `${closedPositionsText}${openPositionsText}`
                : ctx.i18n.t("robot.positionsNone");
        return ctx.editMessageText(
            `${ctx.i18n.t("robot.name", {
                code: robot.code,
                subscribed: userRobot ? "✅" : ""
            })}${message}\n\n${updatedAtText}`,
            getUserRobotMenu(ctx)
        );
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function userRobotAdd(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.ADD_USER_ROBOT, {
            selectedRobot: ctx.scene.state.selectedRobot,
            prevState: { ...ctx.scene.state, silent: false }
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function userRobotDelete(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.DELETE_USER_ROBOT, {
            selectedRobot: ctx.scene.state.selectedRobot,
            prevState: {
                ...ctx.scene.state,
                silent: false,
                page: null,
                edit: false,
                reload: true
            }
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function userRobotEdit(ctx: any) {
    try {
        ctx.scene.state.silent = true;

        await ctx.scene.enter(TelegramScene.EDIT_USER_ROBOT, {
            selectedRobot: ctx.scene.state.selectedRobot,
            prevState: {
                ...ctx.scene.state,
                silent: false,
                page: null,
                edit: false,
                reload: true
            }
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function userRobotStart(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.START_USER_ROBOT, {
            selectedRobot: ctx.scene.state.selectedRobot,
            prevState: {
                ...ctx.scene.state,
                silent: false,
                page: null,
                edit: false,
                reload: true
            }
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function userRobotStop(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.STOP_USER_ROBOT, {
            selectedRobot: ctx.scene.state.selectedRobot,
            prevState: {
                ...ctx.scene.state,
                silent: false,
                page: null,
                edit: false,
                reload: true
            }
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function userRobotBack(ctx: any) {
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

async function userRobotBackEdit(ctx: any) {
    try {
        if (!ctx.scene.state.prevScene) {
            ctx.scene.state.silent = false;
            return ctx.scene.leave();
        }
        ctx.scene.state.silent = true;
        await ctx.scene.enter(ctx.scene.state.prevScene, {
            ...ctx.scene.state.prevState,
            edit: true
        });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export function userRobotScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.USER_ROBOT);
    scene.enter(userRobotInfo.bind(service));
    addBaseActions(scene, service, false);
    scene.action(/info/, userRobotInfo.bind(service));
    scene.action(/pStat/, userRobotPublicStats.bind(service));
    scene.action(/myStat/, userRobotMyStats.bind(service));
    scene.action(/pos/, userRobotPositions.bind(service));
    scene.action(/edit/, userRobotEdit.bind(service));
    scene.action(/start/, userRobotStart.bind(service));
    scene.action(/stop/, userRobotStop.bind(service));
    scene.action(/add/, userRobotAdd.bind(service));
    scene.action(/delete/, userRobotDelete.bind(service));
    scene.action(/back/, userRobotBackEdit.bind(service));
    scene.hears(match("keyboards.backKeyboard.back"), userRobotBack.bind(service));
    scene.command("back", userRobotBack.bind(service));
    return scene;
}
