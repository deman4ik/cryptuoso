const EN = {
    subjects: {
        welcome: "🚀 Welcome to Cryptuoso Platform - Please confirm your email.",
        userAccountActivated: "🚀 Welcome to Cryptuoso Platform - User Account Activated.",
        passwordChangeConfirmation: "🔐 Cryptuoso - Change Password Confirmation.",
        passwordReset: "🔐 Cryptuoso - Password Reset Request.",
        passwordResetConfirmation: "🔐 Cryptuoso - Reset Password Confirmation.",
        changeEmail: "🔐 Cryptuoso - Change Email Request.",
        changeEmailConfirmation: "🔐 Cryptuoso - Email Change Confirmation.",
        // TODO: check
        notificationsAggregate: "🔔 Your notifications",
        signalAlert: "🔔 Signal Alert.",
        signalTrade: "🔔 Signal Trade."
    },
    bodies: {
        welcome: ({ secretCode, urlData }: { secretCode: any; urlData: any }) => `<p>Greetings!</p>
            <p>Your user account is successfully created!</p>
            <p>Activate your account by confirming your email please click <b><a href="https://cryptuoso.com/auth/activate-account/${urlData}">this link</a></b></p>
            <p>or enter this code <b>${secretCode}</b> manually on confirmation page.</p>`,
        userAccountActivated: `<p>Congratulations!</p>
            <p>Your user account is successfully activated!</p>
            <p>Now you can login to <b><a href="https://cryptuoso.com/auth/login">your account</a></b> using your email and password.</p>
            <p>Please check out our <b><a href="https://support.cryptuoso.com">Documentation Site</a></b> to get started!</p>`,
        passwordChangeConfirmation: `
            <p>Your password successfully changed!</p>
            <p>If you did not request this change, please contact support <a href="mailto:support@cryptuoso.com">support@cryptuoso.com</a></p>`,
        passwordReset: ({ secretCode, urlData }: { secretCode: any; urlData: any }) => `
            <p>We received a request to reset your password. Please create a new password by clicking <a href="https://cryptuoso.com/auth/confirm-password-reset/${urlData}">this link</a></p>
            <p>or enter this code <b>${secretCode}</b> manually on reset password confirmation page.</p>
            <p>This request will expire in 1 hour.</p>
            <p>If you did not request this change, no changes have been made to your user account.</p>`,
        passwordResetConfirmation: `
            <p>Your password successfully changed!</p>
            <p>If you did not request this change, please contact support <a href="mailto:support@cryptuoso.com">support@cryptuoso.com</a></p>`,
        changeEmail: ({ secretCode }: { secretCode: any }) => `<p>We received a request to change your email.</p>
            <p>Please enter this code <b>${secretCode}</b> to confirm.</p>
            <p>This request will expire in 1 hour.</p>
            <p>If you did not request this change, no changes have been made to your user account.</p>`,
        changeEmailConfirmation: ({ emailNew }: { emailNew: any }) => `
            <p>Your email successfully changed to ${emailNew}!</p>
            <p>If you did not request this change, please contact support <a href="mailto:support@cryptuoso.com">support@cryptuoso.com</a></p>`
    },
    signal: {
        alert: ({ code }: { code: any }) => `🚨 New Signal!\n\n🤖 Robot: <b>#${code}</b>\n\n`,
        trade: ({ code }: { code: any }) => `🚨✅ New Signal Trade!\n\n🤖 Robot: <b>#${code}</b>\n\n`
    },
    robot: {
        menuInfo: "ℹ️ Robot Info",
        menuPublStats: "📉 Public Statistics",
        menuMyStats: "📈 My Statistics",
        menuPositions: "🗃 Latest positions",
        name: ({ code, subscribed }: { code: any; subscribed: any }) => `🤖\nRobot: <b>#${code}</b> ${subscribed}\n\n`,
        info: ({
            code,
            subscribed,
            description,
            signalsCount
        }: {
            code: any;
            subscribed: any;
            description: any;
            signalsCount: any;
        }) =>
            `🤖\nRobot: <b>#${code}</b> ${subscribed}\n<b>Description:</b> ${description}\n<b>Maximum signals:</b> ${signalsCount} per day\n\n`,
        profit: ({ profit, lastProfit }: { profit: any; lastProfit: any }) =>
            `<b>Performance:</b> ${profit}$ / ${lastProfit}$\n\n`,
        volume: ({ volume, asset }: { volume: any; asset: any }) => `<b>Amount:</b> ${volume} ${asset}\n\n`,
        subscribedAt: ({ subscribedAt }: { subscribedAt: any }) => `<b>Subscribed at:</b> ${subscribedAt}\n\n`,
        startedAt: ({ startedAt }: { startedAt: any }) => `<b>Started at:</b> ${startedAt}\n\n`,
        stoppedAt: ({ stoppedAt }: { stoppedAt: any }) => `<b>Stopped at:</b> ${stoppedAt}\n\n`,
        lastInfoUpdatedAt: ({ lastInfoUpdatedAt }: { lastInfoUpdatedAt: any }) =>
            `Info updated: ${lastInfoUpdatedAt}\n`,
        status: ({ status }: { status: any }) => `<b>Status:</b> ${status}\n`,
        userExAcc: ({ name }: { name: any }) => `<b>Exchange API Key:</b> ${name}\n\n`,
        signals: ({ signals }: { signals: any }) => `<b>Latest signals:</b>\n${signals}`,
        signal: ({
            code,
            action,
            orderType,
            timestamp,
            price
        }: {
            code: any;
            action: any;
            orderType: any;
            timestamp: any;
            price: any;
        }) =>
            `<b>Position:</b> ${code}\n<b>Action:</b> ${action}\n<b>Order type:</b> ${orderType}\n<b>Signal time:</b> ${timestamp}\n<b>Price:</b> ${price}$\n`,
        signalsNone: "\n\nRobot hasn't current signals",
        positionsOpen: ({ openPositions }: { openPositions: any }) => `<b>📬 Open positions:</b> ${openPositions}`,
        positionOpen: ({
            code,
            entryAction,
            entryDate,
            entryPrice
        }: {
            code: any;
            entryAction: any;
            entryDate: any;
            entryPrice: any;
        }) =>
            `-------\n<b>Position:</b> ${code}\n\n<b>Entry:</b> ${entryAction}\n<b>Entry Date:</b> ${entryDate}\n<b>Entry Price:</b> ${entryPrice}$\n`,
        positionSignals: ({ signals }: { signals: any }) => `<b>Exit signals:</b> ${signals}`,
        positionsClosed: ({ closedPositions }: { closedPositions: any }) =>
            `<b>📪 Closed positions:</b> ${closedPositions}\n`,
        positionClosed: ({
            code,
            entryAction,
            entryDate,
            entryPrice,
            exitAction,
            exitDate,
            exitPrice,
            barsHeld,
            profit
        }: {
            code: any;
            entryAction: any;
            entryDate: any;
            entryPrice: any;
            exitAction: any;
            exitDate: any;
            exitPrice: any;
            barsHeld: any;
            profit: any;
        }) =>
            `-------\n<b>Position:</b> ${code}\n\n<b>Entry:</b> ${entryAction}\n<b>Entry Date:</b> ${entryDate}\n<b>Entry Price:</b> ${entryPrice}$\n\n<b>Exit:</b> ${exitAction}\n<b>Exit Date:</b> ${exitDate}\n<b>Exit Price:</b> ${exitPrice}$\n\n<b>Bars Held:</b> ${barsHeld}\n<b>Profit:</b> ${profit}$\n`,
        positionsNone: "Robot has no positions yet...",
        statsLastUpdatedAt: ({ lastUpdatedAt }: { lastUpdatedAt: any }) =>
            `<b>Stats last updated at:</b> ${lastUpdatedAt}\n`,
        statsProfit: ({
            netProfit,
            tradesCount,
            avgNetProfit,
            avgBarsHeld,
            profitFactor,
            recoveryFactor,
            payoffRatio,
            maxDrawdown,
            maxDrawdownDate
        }: {
            netProfit: { all: any };
            tradesCount: { all: any };
            avgNetProfit: { all: any };
            avgBarsHeld: { all: any };
            profitFactor: { all: any };
            recoveryFactor: { all: any };
            payoffRatio: { all: any };
            maxDrawdown: { all: any };
            maxDrawdownDate: { all: any };
        }) =>
            `<b>💰 Profit</b> \n\n<b>Net Profit:</b> ${netProfit.all}$ \n<b>Number of Trades:</b> ${tradesCount.all} \n<b>Average Profit:</b> ${avgNetProfit.all}$ \n<b>Average Bars held:</b> ${avgBarsHeld.all} \n<b>Profit Factor:</b> ${profitFactor.all} \n<b>Recovery Factor:</b> ${recoveryFactor.all} \n<b>Payoff Ratio:</b> ${payoffRatio.all} \n<b>Maximum Drawdown:</b> ${maxDrawdown.all}$ \n<b>Maximum Drawdown Date:</b> ${maxDrawdownDate.all} \n\n`,
        statsWinners: ({
            winRate,
            grossProfit,
            avgProfit,
            avgBarsHeldWinning,
            maxConnsecWins
        }: {
            winRate: { all: any };
            grossProfit: { all: any };
            avgProfit: { all: any };
            avgBarsHeldWinning: { all: any };
            maxConnsecWins: { all: any };
        }) =>
            `<b>🏆 Winners</b> \n\n<b>Win Rate:</b> ${winRate.all}%\n<b>Gross Profit:</b> ${grossProfit.all}$ \n<b>Average Profit:</b> ${avgProfit.all}$ \n<b>Average Bars held:</b> ${avgBarsHeldWinning.all} \n<b>Max. Consecutive Winners:</b> ${maxConnsecWins.all} \n\n`,
        statsLosses: ({
            lossRate,
            grossLoss,
            avgLoss,
            avgBarsHeldLosing,
            maxConsecLosses
        }: {
            lossRate: { all: any };
            grossLoss: { all: any };
            avgLoss: { all: any };
            avgBarsHeldLosing: { all: any };
            maxConsecLosses: { all: any };
        }) =>
            `<b>🌋 Losses</b> \n\n<b>Loss Rate:</b> ${lossRate.all}%\n<b>Gross Loss:</b> ${grossLoss.all}$ \n<b>Average Loss:</b> ${avgLoss.all}$ \n<b>Average Bars held:</b> ${avgBarsHeldLosing.all} \n<b>Max. Consecutive Losses:</b> ${maxConsecLosses.all} \n\n`,
        statsNone: "Robot has no statistics yet..."
    },
    tradeAction: {
        long: "BUY ⬆️ (Long ✳️)",
        short: "SELL ⬇️ (Short 🔴)",
        closeLong: "SELL ⬇️ (Close Long ✳️)",
        closeShort: "BUY ⬆️ (Close Short 🔴)"
    },
    status: {
        pending: "⏳ Pending",
        queued: "🌀 Queued",
        starting: "✳️ Starting",
        stopping: "✴️ Stopping",
        started: "🟢 Started",
        stopped: "⛔ Stopped",
        paused: "📛 Paused",
        finished: "🏁 Finished",
        failed: "❌ Failed",
        resumed: "♻️ Resumed"
    },
    orderType: {
        market: "Market 〽️",
        limit: "Limit ✴️",
        stop: "Stop ⛔"
    },
    userRobot: {
        description:
            "The trend is your friend. Breakout trading is used by active investors to take a position within a trend's early stages. This strategy can be the starting point for major price moves, expansions in volatility and, when managed properly, can offer limited downside risk.",
        error: ({ jobType, error, code, id }: { jobType: any; error: any; code: any; id: any }) =>
            `❌ Error occurred while processing robot job <b>${jobType}</b>.\n\n${error} \n\n🤖 <b>#${code}</b> (${id})\n\n Please contact support.`,
        orderError: ({ exId, error, code, id }: { exId: any; error: any; code: any; id: any }) =>
            `❌ Error occurred while processing order <b>${exId}</b>.\n\n${error} \n\n🤖 <b>#${code}</b> (${id})\n\n Please check your API Keys and Robot settings or contact support.`,
        status: ({ code, status, message }: { code: any; status: any; message: any }) =>
            `🤖 Robot <b>#${code}</b> is ${status} now!\n\n${message}`
    }
};

export enum LANGS {
    EN = "en"
}

const LOCALES: {
    [L in LANGS]: typeof EN;
} = {
    [LANGS.EN]: EN
};

export default LOCALES;
