const EN = {
    welcome: ({ username }: { username: string }) =>
        `Welcome ${username} to <b>Cryptuoso Trading Bot!</b>\n\nYou can start <b>Manual trading</b> with our 🚦 Signals or <b>Automated Trading</b> with our 🤖 Robots.\n\nWe advise to divide your trading capital between different robots to maximize the diversification effect and don't borrow margin (credit) money, because cryptocurrency markets are very volatile.\n\nBy starting this bot you confirm that you have read and accept our <a href='https://support.cryptuoso.com/terms-of-use'>terms of use</a>.\n\n⚠️ Use all signals and robots at your own risk!`,
    failed: "❌ Failed to process your request. Please try again later!",
    keyboards: {
        backKeyboard: {
            back: "◀️ Back",
            menu: "🏠 Main Menu"
        },
        mainKeyboard: {
            signals: "🚦 Signals",
            robots: "🤖 Robots",
            settings: "⚙️ Settings",
            support: "❓ Support",
            donation: "💰 Donation"
        },
        confirm: {
            yes: "Yes",
            no: "No"
        }
    },
    scenes: {
        signals: {
            info: "🚦 Signals - Manual Trading Mode",
            my: "🚥 My Signals",
            search: "🔎 Search Signals",
            top: "🏆 Top Performance Signals",
            performance: "📊 My Total Performance"
        },
        searchSignals: {
            selectExchange: "🔎 Searching Signal Robots\n\nSelect available <b>exchange</b>",
            selectAsset: ({ exchange }: { exchange: string }) =>
                `🔎 Searching Signal Robots\n\nSelect available  <b>${exchange}</b> <b>cryptocurrency</b> pair`,
            selectRobot: ({ exchange, asset }: { exchange: string; asset: string }) =>
                `🔎 Searching Signal Robots\n\nSelect available <b>${exchange}</b> <b>${asset}</b> robot`
        },
        topSignals: {
            selectExchange: "🏆 Top Performance Signal Robots\n\nSelect available <b>exchange</b>",
            selectRobot: "🏆 Top Performance Signal Robots"
        },
        mySignals: {
            robotsList: "🚥 Robot signals you subscribed to:",
            robotsNone: "🚥 You are not subscribed to any signals.",
            add: "✅ Add Signals"
        },
        perfSignals: {
            info: "📊 My Signals Total Performance",
            perfNone: "No enough data to calculate Signals Performance yet..."
        },
        robotSignal: {
            subscribeSignals: "🚥 Subscribe to Signals",
            unsubscribeSignals: "❌ Unsubscribe from Signals",
            changeVolume: "⚙️ Change Amount",
            unsubscribedSignals: ({ code }: { code: string }) => `You unsubsribed from <b>#${code}</b> signals =(`,
            unsubscribedFailed: ({ code, error }: { code: string; error: string }) =>
                `Failed to unsubscribe from <b>#${code}</b> signals - ${error}`
        },
        subscribeSignals: {
            enterVolume: ({ code, asset, minVolume }: { code: string; asset: string; minVolume: string }) =>
                `🚥 Subscribing to #${code} robot.\n\n<b>Please enter desired trading amount in ${asset}.</b>\n\nMinimum value is ${minVolume} ${asset}`,
            wrongVolume: ({ code, minVolume, asset }: { code: string; minVolume: string; asset: string }) =>
                `🚥 Subscribing to #${code} robot.\n\nWrong amount format.\nMinimum value is ${minVolume} ${asset}`,
            subscribedSignals: ({ code, volume, asset }: { code: string; volume: string; asset: string }) =>
                `🚥 Succesfully subsribed to <b>#${code}</b> signals with amount ${volume} ${asset}!\n\n⚠️ Use all signals at your own risk!`
        },
        robots: {
            info: "🤖 Robots - Automated Trading Mode",
            my: "🤖 My Robots",
            search: "🔎 Search Robots",
            top: "🏆 Top Performance Robots",
            performance: "📈 My Total Performance"
        },
        myRobots: {
            robotsList: "🤖 My Robots:",
            robotsNone: "🤖 You have not added any robots.",
            add: "✅ Add Robots"
        },
        perfRobots: {
            info: "📊 My trading Robots Total Performance",
            perfNone: "No enough data to calculate trading Robots Performance yet..."
        },
        searchRobots: {
            selectExchange: "🔎 Searching Robots\n\nSelect available <b>exchange</b>",
            selectAsset: ({ exchange }: { exchange: string }) =>
                `🔎 Searching Robots\n\nSelect available  <b>${exchange}</b> <b>cryptocurrency</b> pair`,
            selectRobot: ({ exchange, asset }: { exchange: string; asset: string }) =>
                `🔎 Searching Robots\n\nSelect available <b>${exchange}</b> <b>${asset}</b> robot`
        },
        topRobots: {
            selectExchange: "🏆 Top Performance Robots\n\nSelect available <b>exchange</b>",
            selectRobot: "🏆 Top Performance Robots"
        },
        userRobot: {
            add: "✅ Add Robot",
            delete: "❌ Delete Robot",
            edit: "⚙️ Edit Trading Volume",
            start: "🟢 Start Robot",
            stop: "⛔ Stop Robot"
        },
        addUserRobot: {
            selectExAcc: ({ code, exchange }: { code: string; exchange: string }) =>
                `✅ Adding robot #${code}.\n\nSelect your ${exchange} API Key:`,
            noneExAccs: ({ code, exchange }: { code: string; exchange: string }) =>
                `✅ Adding robot #${code}.\n\nYou have not registered any ${exchange} API Keys.`,
            enterVolume: ({ code, asset, minVolume }: { code: string; asset: string; minVolume: string }) =>
                `✅ Adding robot #${code}.\n\n<b>Please enter desired trading amount in ${asset}.</b>\n\nMinimum value is ${minVolume} ${asset}`,
            wrongVolume: ({ code, minVolume, asset }: { code: string; minVolume: string; asset: string }) =>
                `✅ Adding robot #${code}.\n\nWrong amount format.\nMinimum value is ${minVolume} ${asset}`,
            success: ({ code, volume, asset }: { code: string; volume: string; asset: string }) =>
                `✅ Succesfully added <b>#${code}</b> robot with trading amount ${volume} ${asset}!`
        },
        editUserRobot: {
            enterVolume: ({ code, asset, minVolume }: { code: string; asset: string; minVolume: string }) =>
                `⚙️ Editing robot #${code} settings.\n\n<b>Please enter desired trading amount in ${asset}.</b>\n\nMinimum value is ${minVolume} ${asset}`,
            wrongVolume: ({ code, minVolume, asset }: { code: string; minVolume: string; asset: string }) =>
                `⚙️ Editing robot #${code} settings.\n\nWrong amount format.\nMinimum value is ${minVolume} ${asset}`,
            success: ({ code, volume, asset }: { code: string; volume: string; asset: string }) =>
                `⚙️ Succesfully edited <b>#${code}</b> robot. New trading amount ${volume} ${asset}!`
        },
        deleteUserRobot: {
            confirm: ({ code }: { code: string }) =>
                `❌ Deleting <b>#${code}</b> robot...\n\n⚠️ Are you sure you want to delete <b>#${code}</b> robot?\n\n You will lost all your trading history for this robot!`,
            failed: ({ code, error }: { code: string; error: string }) =>
                `❌ Failed to delele robot #${code} - ${error}`,
            success: ({ code }: { code: string }) => `✅ Succesfully deleted <b>#${code}</b> robot.`
        },
        startUserRobot: {
            confirm: ({ code }: { code: string }) =>
                `🟢 Starting <b>#${code}</b> robot...\n\n⚠️ Are you sure you want to start <b>#${code}</b> robot now?\n\n It is a realtime automated trading mode using your exchange account and you use it at your own risk!`,
            failed: ({ code, error }: { code: string; error: string }) =>
                `❌ Failed to start robot #${code} - ${error}`,
            success: ({ code }: { code: string }) => `🟢 <b>#${code}</b> robot is starting now...`
        },
        stopUserRobot: {
            confirm: ({ code }: { code: string }) =>
                `⛔ Stopping <b>#${code}</b> robot...\n\n⚠️ Are you sure you want to stop <b>#${code}</b> robot now?\n\n If there is any <b>open positions</b> created by this robot they will be <b>canceled</b> (closed) with current market prices and potentially may cause profit <b>losses</b>!`,
            failed: ({ code, error }: { code: string; error: string }) => `❌ Failed to stop robot #${code} - ${error}`,
            success: ({ code }: { code: string }) => `⛔ <b>#${code}</b> robot is stopping now...`
        },
        settings: {
            info: ({
                email,
                telegramSignalsNotif,
                telegramTradingNotif
            }: {
                email: string;
                telegramSignalsNotif: string;
                telegramTradingNotif: string;
            }) =>
                `<b>👤 Account info</b>\n\n<b>📨 Email:</b> ${email}\n\n${telegramSignalsNotif}\n${telegramTradingNotif}`,
            emailNotSet: "Not set",
            setEmail: "📨 Set Email",
            changeEmail: "📨 Change Email",
            userExAccs: "🔐 My Exchange API Keys",
            telegramSingalsNotifOn: "🚦 Telegram signals notifications is <b>ON</b> 🔔",
            telegramSingalsNotifOff: "🚦 Telegram signals notifications is <b>OFF</b> 🔕",
            TelegramTradingNotifOn: "🤖 Telegram trading notifications is <b>ON</b> 🔔",
            TelegramTradingNotifOff: "🤖 Telegram trading notifications is <b>OFF</b> 🔕",
            turnTelegramSignalsNotifOff: "🚦 Turn Telegram signals notifications OFF 🔕",
            turnTelegramSignalsNotifOn: "🚦 Turn Telegram signals notifications ON 🔔",
            turnTelegramTradingNotifOff: "🤖 Turn Telegram trading notifications OFF 🔕",
            turnTelegramTradingNotifOn: "🤖 Turn Telegram trading notifications ON 🔔"
        },
        userExAccs: {
            add: "🔑 Add New Exchange API Keys",
            none: "🔑 You hasn't any Exchange API Keys yet"
        },
        addUserExAcc: {
            chooseExchange:
                "🔑 Adding New Exchange API Key\n\nYou can learn how to configure keys in our <a href='https://support.cryptuoso.com/exchange-accounts'>docs</a>.\n\n<b>Choose one of available exchanges:</b>",
            enterAPIKey: ({ exchange }: { exchange: string }) =>
                `🔑 Adding New Exchange API Key\n\nYou can learn how to configure keys in our <a href='https://support.cryptuoso.com/exchange-accounts'>docs</a>.\n\nEnter your ${exchange} <b>API KEY</b>`,
            enterAPISecret: ({ exchange }: { exchange: string }) =>
                `🔑 Adding New Exchange API Key\n\nYou can learn how to configure keys in our <a href='https://support.cryptuoso.com/exchange-accounts'>docs</a>.\n\nEnter your ${exchange} <b>API Key Secret (Private Key)</b>`,
            check: ({ exchange }: { exchange: string }) =>
                `🔑 Adding New Exchange API Key\n\n🌀 Checking your ${exchange} API Key...\n\n⏳ Please wait...`,
            success: ({ name }: { name: string }) => `🔑 New ${name} API Key succesfully added!`,
            failed: ({ exchange, error }: { exchange: string; error: string }) =>
                `❌ Failed to add new ${exchange} API Key.\n\n<b>${error}</b>\n\nPlease try again!\n\nYou can learn how to configure keys in our <a href='https://support.cryptuoso.com/exchange-accounts'>docs</a>.`
        },
        editUserExAcc: {
            enterAPIKey: ({ name, exchange }: { name: string; exchange: string }) =>
                `🔑 Editing ${name} API Key\n\n<b>Enter your ${exchange} API Key</b>`,
            enterAPISecret: ({ name, exchange }: { name: string; exchange: string }) =>
                `🔑 Editing ${name} API Key\n\n<b>Enter your ${exchange} API Secret</b>`,
            success: ({ name }: { name: string }) => `🔑 ${name} API Key succesfully edited!`,
            failed: ({ name, error }: { name: string; error: string }) =>
                `❌ Failed to edit ${name} API Key.\n\n<b>${error}</b>\n\nPlease try again!`
        },
        userExAcc: {
            info: ({ name, status }: { name: string; status: string }) =>
                `🔐 <b>${name} API Key</b>\n\n<b>Status:</b> ${status}`,
            edit: "🔑 Edit",
            delete: "❌ Delete",
            deleteSuccess: ({ name }: { name: string }) => `🔑 ${name} API Key deleted successfully`,
            deleteFailed: ({ name, error }: { name: string; error: string }) =>
                `❌ Failed to delete ${name} API Key.\n\n<b>${error}</b>\n\nPlease try again!`
        },
        support: {
            info1:
                "❓Support\n\n📃 You can learn all about Cryptuoso Platform, how to use and configure signals, robots and exchange accounts in our <a href='https://support.cryptuoso.com'>Documentation site</a>.\n\n",
            info2:
                "❓Having common questions with signals or robots? Ask it in our <a href='https://t.me/joinchat/ACVS-0zaWVBgAYm8gOKYHA'>Telegram Community</a> and we will help you.\n\n",
            info3:
                "❗️Have a personal problem regarding connecting an exchange or billing? You can reach us at <a href='mailto:support@cruptuoso.com'>support@cruptuoso.com</a>.\n\n",
            info4:
                "Also you can <b>type and send your message right now ⬇️ to this bot</b>\n\n(works only while you in Support section)",
            success:
                "✅ Your support request have been received.\n\nIf you have any additional information regarding your issue\n\n you can use <b>❓Support</b> section again!",
            reply: ({ message }: { message: string }) =>
                `❓New Message from <b>Support Team</b>:\n\n${message}\n\nYou can reply to us in <b>❓Support</b> section.`
        }
    },
    signal: {
        alert: ({ code }: { code: string }) => `🚨 New Signal!\n\n🤖 Robot: <b>#${code}</b>\n\n`,
        trade: ({ code }: { code: string }) => `🚨✅ New Signal Trade!\n\n🤖 Robot: <b>#${code}</b>\n\n`
    },
    userTrade: {
        new: ({ code }: { code: string }) => `🤖✅ New Robot Trade!\n\n🤖 Robot: <b>#${code}</b>\n\n`,
        open: ({
            code,
            entryAction,
            entryDate,
            entryPrice,
            volume,
            asset
        }: {
            code: string;
            entryAction: string;
            entryDate: string;
            entryPrice: string;
            volume: string;
            asset: string;
        }) =>
            `-------\n<b>Position:</b> ${code}\n\n<b>Entry:</b> ${entryAction}\n<b>Entry Date:</b> ${entryDate}\n<b>Entry Price:</b> ${entryPrice}$\n<b>Amount:</b> ${volume} ${asset}`,
        closed: ({
            code,
            entryAction,
            entryDate,
            entryPrice,
            exitAction,
            exitDate,
            exitPrice,
            volume,
            asset,
            barsHeld,
            profit
        }: {
            code: string;
            entryAction: string;
            entryDate: string;
            entryPrice: string;
            exitAction: string;
            exitDate: string;
            exitPrice: string;
            volume: string;
            asset: string;
            barsHeld: string;
            profit: string;
        }) =>
            `-------\n<b>Position:</b> ${code}\n\n<b>Entry:</b> ${entryAction}\n<b>Entry Date:</b> ${entryDate}\n<b>Entry Price:</b> ${entryPrice}$\n\n<b>Exit:</b> ${exitAction}\n<b>Exit Date:</b> ${exitDate}\n<b>Exit Price:</b> ${exitPrice}$\n\n<b>Amount:</b> ${volume} ${asset}\n\n<b>Bars Held:</b> ${barsHeld}\n<b>Profit:</b> ${profit}$\n`
    },
    robot: {
        menuInfo: "ℹ️ Robot Info",
        menuPublStats: "📉 Public Statistics",
        menuMyStats: "📈 My Statistics",
        menuPositions: "🗃 Latest positions",
        name: ({ code, subscribed }: { code: string; subscribed: string }) =>
            `🤖\nRobot: <b>#${code}</b> ${subscribed}\n\n`,
        info: ({
            code,
            subscribed,
            description,
            signalsCount
        }: {
            code: string;
            subscribed: string;
            description: string;
            signalsCount: string;
        }) =>
            `🤖\nRobot: <b>#${code}</b> ${subscribed}\n<b>Description:</b> ${description}\n<b>Maximum signals:</b> ${signalsCount} per day\n\n`,
        profit: ({ profit, lastProfit }: { profit: string; lastProfit: string }) =>
            `<b>Performance:</b> ${profit}$ / ${lastProfit}$\n\n`,
        volume: ({ volume, asset }: { volume: string; asset: string }) => `<b>Amount:</b> ${volume} ${asset}\n\n`,
        subscribedAt: ({ subscribedAt }: { subscribedAt: string }) => `<b>Subscribed at:</b> ${subscribedAt}\n\n`,
        startedAt: ({ startedAt }: { startedAt: string }) => `<b>Started at:</b> ${startedAt}\n\n`,
        stoppedAt: ({ stoppedAt }: { stoppedAt: string }) => `<b>Stopped at:</b> ${stoppedAt}\n\n`,
        lastInfoUpdatedAt: ({ lastInfoUpdatedAt }: { lastInfoUpdatedAt: string }) =>
            `Info updated: ${lastInfoUpdatedAt}\n`,
        status: ({ status }: { status: string }) => `<b>Status:</b> ${status}\n`,
        userExAcc: ({ name }: { name: string }) => `<b>Exchange API Key:</b> ${name}\n\n`,
        signals: ({ signals }: { signals: string }) => `<b>Latest signals:</b>\n${signals}`,
        signal: ({
            code,
            action,
            orderType,
            timestamp,
            price
        }: {
            code: string;
            action: string;
            orderType: string;
            timestamp: string;
            price: string;
        }) =>
            `<b>Position:</b> ${code}\n<b>Action:</b> ${action}\n<b>Order type:</b> ${orderType}\n<b>Signal time:</b> ${timestamp}\n<b>Price:</b> ${price}$\n`,
        signalsNone: "\n\nRobot hasn't current signals",
        positionsOpen: ({ openPositions }: { openPositions: string }) => `<b>📬 Open positions:</b> ${openPositions}`,
        positionOpen: ({
            code,
            entryAction,
            entryDate,
            entryPrice
        }: {
            code: string;
            entryAction: string;
            entryDate: string;
            entryPrice: string;
        }) =>
            `-------\n<b>Position:</b> ${code}\n\n<b>Entry:</b> ${entryAction}\n<b>Entry Date:</b> ${entryDate}\n<b>Entry Price:</b> ${entryPrice}$\n`,
        positionSignals: ({ signals }: { signals: string }) => `<b>Exit signals:</b> ${signals}`,
        positionsClosed: ({ closedPositions }: { closedPositions: string }) =>
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
            code: string;
            entryAction: string;
            entryDate: string;
            entryPrice: string;
            exitAction: string;
            exitDate: string;
            exitPrice: string;
            barsHeld: string;
            profit: string;
        }) =>
            `-------\n<b>Position:</b> ${code}\n\n<b>Entry:</b> ${entryAction}\n<b>Entry Date:</b> ${entryDate}\n<b>Entry Price:</b> ${entryPrice}$\n\n<b>Exit:</b> ${exitAction}\n<b>Exit Date:</b> ${exitDate}\n<b>Exit Price:</b> ${exitPrice}$\n\n<b>Bars Held:</b> ${barsHeld}\n<b>Profit:</b> ${profit}$\n`,
        positionsNone: "Robot has no positions yet...",
        statsLastUpdatedAt: ({ lastUpdatedAt }: { lastUpdatedAt: string }) =>
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
            netProfit: { all: string };
            tradesCount: { all: string };
            avgNetProfit: { all: string };
            avgBarsHeld: { all: string };
            profitFactor: { all: string };
            recoveryFactor: { all: string };
            payoffRatio: { all: string };
            maxDrawdown: { all: string };
            maxDrawdownDate: { all: string };
        }) =>
            `<b>💰 Profit</b> \n\n<b>Net Profit:</b> ${netProfit.all}$ \n<b>Number of Trades:</b> ${tradesCount.all} \n<b>Average Profit:</b> ${avgNetProfit.all}$ \n<b>Average Bars held:</b> ${avgBarsHeld.all} \n<b>Profit Factor:</b> ${profitFactor.all} \n<b>Recovery Factor:</b> ${recoveryFactor.all} \n<b>Payoff Ratio:</b> ${payoffRatio.all} \n<b>Maximum Drawdown:</b> ${maxDrawdown.all}$ \n<b>Maximum Drawdown Date:</b> ${maxDrawdownDate.all} \n\n`,
        statsWinners: ({
            winRate,
            grossProfit,
            avgProfit,
            avgBarsHeldWinning,
            maxConnsecWins
        }: {
            winRate: { all: string };
            grossProfit: { all: string };
            avgProfit: { all: string };
            avgBarsHeldWinning: { all: string };
            maxConnsecWins: { all: string };
        }) =>
            `<b>🏆 Winners</b> \n\n<b>Win Rate:</b> ${winRate.all}%\n<b>Gross Profit:</b> ${grossProfit.all}$ \n<b>Average Profit:</b> ${avgProfit.all}$ \n<b>Average Bars held:</b> ${avgBarsHeldWinning.all} \n<b>Max. Consecutive Winners:</b> ${maxConnsecWins.all} \n\n`,
        statsLosses: ({
            lossRate,
            grossLoss,
            avgLoss,
            avgBarsHeldLosing,
            maxConsecLosses
        }: {
            lossRate: { all: string };
            grossLoss: { all: string };
            avgLoss: { all: string };
            avgBarsHeldLosing: { all: string };
            maxConsecLosses: { all: string };
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
    userExAcc: {
        error: ({ name, error }: { name: string; error: string }) =>
            `❌ Your API Key 🔐 ${name} is invalid!\n\n ${error}\n\nPlease update your API Key information in settings.`
    },
    userRobot: {
        description:
            "The trend is your friend. Breakout trading is used by active investors to take a position within a trend's early stages. This strategy can be the starting point for major price moves, expansions in volatility and, when managed properly, can offer limited downside risk.",
        error: ({ jobType, error, code, id }: { jobType: string; error: string; code: string; id: string }) =>
            `❌ Error occurred while processing robot job <b>${jobType}</b>.\n\n${error} \n\n🤖 <b>#${code}</b> (${id})\n\n Please contact support.`,
        orderError: ({ exId, error, code, id }: { exId: string; error: string; code: string; id: string }) =>
            `❌ Error occurred while processing order <b>${exId}</b>.\n\n${error} \n\n🤖 <b>#${code}</b> (${id})\n\n Please check your API Keys and Robot settings or contact support.`,
        status: ({ code, status, message }: { code: string; status: string; message: string }) =>
            `🤖 Robot <b>#${code}</b> is ${status} now!\n\n${message}`
    },
    unknownError: "Unknown error",
    menu: "Please use Menu in Telegram keyboard section ↘️",
    signalsMenu: "🚦 Signals\nPlease use Signals Menu in Telegram keyboard section ↘️",
    robotsMenu: "🤖 Robots\nPlease use Robots Menu in Telegram keyboard section ↘️",
    defaultHandler: "🚧 Hey, please choose a section with the Telegram keyboard before typing anything",
    contact:
        "You can reach us in <a href='https://t.me/joinchat/ACVS-0zaWVBgAYm8gOKYHA'>Telegram Community Chat</a>\nor by email <a href='mailto:support@cryptuoso.com'>support@cryptuoso.com</a>\n\nAlso visit:\n\n<a href='https://cryptuoso.com'>Our web site</a>\n\n<a href='https://t.me/cryptuoso'>Telegram Channel</a>\n\n<a href='https://www.instagram.com/cryptuoso/'>Instagram account</a>",
    donation:
        "If you like what we do, please donate some coins. 💸\n\nBitcoin Address:\n14JMUUDpCqfKxGn3LLh5ViHAegdP2N1C8c\nEthereum Address:\n0xD80E764751424cF71BAa83C0fB6afbECE753Cf68\nBitcoin Cash Address:\nbitcoincash:qzuuv8fm3us85yse474cs4wspjfm00e5n5c93cmu78\nLitecoin Address:\nLhHPygdGkQt6q1sNFc1b3mVKVhxJ53cQVH\nDash Address:\nXemAGkD2eY3hV5T87X46pJEX2qhEsdJt7c"
};
