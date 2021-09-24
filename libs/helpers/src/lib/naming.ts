import { capitalize } from "./text";

export function formatExchange(exchange: string): string {
    return exchange
        .split("_")
        .map((val) => capitalize(val))
        .join(" ");
}

export function robotExchangeName(exchange: string, delim = " "): string {
    const formated = formatExchange(exchange).split(" ");
    if (formated.length === 1) return formated[0];
    return `${formated[0]}${delim}${formated[1].substring(0, 3)}`;
}

export const plusNum = (value: number) => (value > 0 ? `+${value}` : value);
