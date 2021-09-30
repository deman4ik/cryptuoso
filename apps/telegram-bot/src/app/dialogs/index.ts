import { account } from "./account";
import { checkoutUserSub } from "./checkoutUserSub";
import { createUserSub } from "./createUserSub";
import { editExchangeAcc } from "./editExchangeAcc";
import { addPortfolio } from "./addPortfolio";
import { listPortfolios } from "./listPortfolios";
import { login } from "./login";
import { paymentHistory } from "./paymentHistory";
import { registration } from "./registration";
import { start } from "./start";
import { support } from "./support";
import { trading } from "./trading";

export const dialogs = {
    [account.name]: account,
    [checkoutUserSub.name]: checkoutUserSub,
    [createUserSub.name]: createUserSub,
    [editExchangeAcc.name]: editExchangeAcc,
    [addPortfolio.name]: addPortfolio,
    [listPortfolios.name]: listPortfolios,
    [login.name]: login,
    [paymentHistory.name]: paymentHistory,
    [registration.name]: registration,
    [start.name]: start,
    [support.name]: support,
    [trading.name]: trading
};
