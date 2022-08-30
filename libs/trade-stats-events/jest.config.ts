/* eslint-disable */
export default {
    displayName: "trade-stats-events",

    globals: {
        "ts-jest": { tsconfig: "<rootDir>/tsconfig.spec.json" }
    },
    transform: {
        "^.+\\.[tj]sx?$": "ts-jest"
    },
    moduleFileExtensions: ["ts", "tsx", "js", "jsx"],
    coverageDirectory: "../../coverage/libs/trade-stats-events",
    preset: "../../jest.preset.js"
};
