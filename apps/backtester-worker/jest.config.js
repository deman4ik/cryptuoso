module.exports = {
    name: "backtester-worker",
    preset: "../../jest.config.js",
    coverageDirectory: "../../coverage/apps/backtester-worker",
    globals: { "ts-jest": { tsConfig: "<rootDir>/tsconfig.spec.json" } }
};
