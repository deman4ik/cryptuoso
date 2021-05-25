import { ActionsHandlerError } from "@cryptuoso/errors";

export const checkAssetStatic = (volume: number, min: number, max?: number) => {
    if (volume < min)
        throw new ActionsHandlerError(`Wrong amount! Value must be at least ${min}.`, null, "FORBIDDEN", 403);
    if (max && volume > max)
        throw new ActionsHandlerError(`Wrong amount! Value must be not greater than ${max}.`, null, "FORBIDDEN", 403);
};

export const checkCurrencyDynamic = checkAssetStatic;

//export const checkAssetDynamicDelta = checkAssetStatic;

export const checkBalancePercent = (
    percent: number,
    percentAvailable: number,
    volume: number,
    min: number,
    max?: number
) => {
    if (percent > percentAvailable)
        throw new ActionsHandlerError(
            `Wrong balance percent! Value must be ${percentAvailable} or less.`,
            null,
            "FORBIDDEN",
            403
        );
    checkCurrencyDynamic(volume, min, max);
};
