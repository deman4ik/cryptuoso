import { gql } from "@cryptuoso/graphql-client";
import { BaseService } from "@cryptuoso/service";
import { BaseStatistics } from "@cryptuoso/stats-calc";
import { BaseScene, Extra } from "telegraf";
import { getStatisticsText } from "../helpers";
import { TelegramScene } from "../types";
import { addBaseActions } from "./default";
import { match } from "@edjopato/telegraf-i18n";
import { GA } from "@cryptuoso/analytics";

function getPerfRobotsMenu(ctx: any) {
    return Extra.HTML().markup((m: any) => {
        const buttons = [
            [m.callbackButton(ctx.i18n.t("keyboards.backKeyboard.back"), JSON.stringify({ a: "back" }), false)]
        ];

        return m.inlineKeyboard(buttons);
    });
}

async function perfRobotsEnter(ctx: any) {
    try {
        GA.view(ctx.session.user.id, TelegramScene.PERFORMANCE_ROBOTS);
        const { stats }: { stats: BaseStatistics[] } = await this.gqlClient.request(
            gql`
                query UserSignalsProfit($userId: uuid!) {
                    stats: v_user_aggr_stats(
                        where: {
                            user_id: { _eq: $userId }
                            type: { _eq: "userRobot" }
                            exchange: { _is_null: true }
                            asset: { _is_null: true }
                        }
                    ) {
                        netProfit: net_profit
                        tradesCount: trades_count
                        avgNetProfit: avg_net_profit
                        avgBarsHeld: avg_bars_held
                        profitFactor: profit_factor
                        recoveryFactor: recovery_factor
                        payoffRatio: payoff_ratio
                        maxDrawdown: max_drawdown
                        maxDrawdownDate: max_drawdown_date
                        winRate: win_rate
                        grossProfit: gross_profit
                        avgProfit: avg_profit
                        avgBarsHeldWinning: avg_bars_held_winning
                        maxConsecWins: max_consec_wins
                        lossRate: loss_rate
                        grossLoss: gross_loss
                        avgLoss: avg_loss
                        avgBarsHeldLosing: avg_bars_held_losing
                        maxConsecLosses: max_consec_losses
                        lastUpdatedAt: last_updated_at
                    }
                }
            `,
            { userId: ctx.session.user.id },
            ctx
        );
        let message;
        if (stats && stats[0]) message = getStatisticsText(ctx, stats[0]);
        else message = ctx.i18n.t("scenes.perfRobots.perfNone");
        if (ctx.scene.state.edit) {
            ctx.scene.state.edit = false;
            return ctx.editMessageText(`${ctx.i18n.t("scenes.perfRobots.info")}\n\n` + message, getPerfRobotsMenu(ctx));
        }
        return ctx.reply(`${ctx.i18n.t("scenes.perfRobots.info")}\n\n` + message, getPerfRobotsMenu(ctx));
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        await ctx.scene.leave();
    }
}

async function perfRobotsBack(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.ROBOTS);
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

async function perfRobotsBackEdit(ctx: any) {
    try {
        ctx.scene.state.silent = true;
        await ctx.scene.enter(TelegramScene.ROBOTS, { edit: true });
    } catch (e) {
        this.log.error(e);
        await ctx.reply(ctx.i18n.t("failed"));
        ctx.scene.state.silent = false;
        await ctx.scene.leave();
    }
}

export function perfRobotsScene(service: BaseService) {
    const scene = new BaseScene(TelegramScene.PERFORMANCE_ROBOTS);
    scene.enter(perfRobotsEnter.bind(service));
    addBaseActions(scene, service, false);
    scene.hears(match("keyboards.backKeyboard.back"), perfRobotsBack.bind(service));
    scene.command("back", perfRobotsBack.bind(service));
    scene.action(/back/, perfRobotsBackEdit.bind(service));
    return scene;
}
