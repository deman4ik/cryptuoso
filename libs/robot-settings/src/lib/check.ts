import { ActionsHandlerError } from "@cryptuoso/errors";

export const checkAssetStatic = (volume: number, min: number, max?: number) => {
    if (volume < min)
        throw new ActionsHandlerError(`Wrong volume! Value must be at least ${min}.`, null, "FORBIDDEN", 403);
    if (max && volume > max)
        throw new ActionsHandlerError(`Wrong volume! Value must be not greater than ${max}.`, null, "FORBIDDEN", 403);
};

export const checkCurrencyDynamic = checkAssetStatic;

export const checkAssetDynamicDelta = checkAssetStatic;

export const checkBalancePercent = (
    percent: number,
    percentUsed: number,
    volume: number,
    min: number,
    max?: number
) => {
    if (percentUsed || 0 + percent > 100)
        throw new ActionsHandlerError(
            `Wrong balance percent! Value must be ${100 - percentUsed || 0} or less.`,
            null,
            "FORBIDDEN",
            403
        );
    checkCurrencyDynamic(volume, min, max);
};
