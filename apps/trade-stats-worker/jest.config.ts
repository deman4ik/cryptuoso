export default {
    displayName: "trade-stats-worker",

    globals: {
        "ts-jest": { tsconfig: "<rootDir>/tsconfig.spec.json" }
    },
    transform: {
        "^.+\\.[tj]s$": "ts-jest"
    },
    moduleFileExtensions: ["ts", "js", "html"],
    coverageDirectory: "../../coverage/apps/trade-stats-worker",
    testEnvironment: "node",
    preset: "../../jest.preset.js"
};
