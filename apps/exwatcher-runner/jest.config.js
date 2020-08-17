module.exports = {
    name: "exwatcher-runner",
    preset: "../../jest.config.js",
    coverageDirectory: "../../coverage/apps/exwatcher-runner",
    globals: { "ts-jest": { tsConfig: "<rootDir>/tsconfig.spec.json" } }
};
