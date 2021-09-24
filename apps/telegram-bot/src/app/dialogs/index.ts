import { listPortfolios, listPortfoliosActions } from "./listPortfolios";
import { trading, tradingActions } from "./trading";

export const dialogs = {
    [trading.name]: trading,
    [listPortfolios.name]: listPortfolios
};
