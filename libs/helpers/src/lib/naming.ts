import { capitalize } from "./text";

export function formatExchange(exchange: string) {
    return exchange
        .split("_")
        .map((val) => capitalize(val))
        .join(" ");
}

export function robotExchangeName(exchange: string, delim = " ") {
    const formated = formatExchange(exchange).split(" ");
    return `${formated[0]}${delim}${formated[1].substring(0, 3)}`;
}

// createRobotCode

// createRobotName
