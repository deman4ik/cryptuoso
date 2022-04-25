module.exports = {
    displayName: "webhooks",

    globals: {
        "ts-jest": {
            tsconfig: "<rootDir>/tsconfig.spec.json"
        }
    },
    transform: {
        "^.+\\.[tj]s$": "ts-jest"
    },
    moduleFileExtensions: ["ts", "js", "html"],
    coverageDirectory: "../../coverage/apps/webhooks",
    testEnvironment: "node",
    preset: "../../jest.preset.ts"
};
