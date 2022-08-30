/* eslint-disable */
export default {
    displayName: "telegram-bot",

    globals: {
        "ts-jest": {
            tsconfig: "<rootDir>/tsconfig.spec.json"
        }
    },
    transform: {
        "^.+\\.[tj]s$": "ts-jest"
    },
    moduleFileExtensions: ["ts", "js", "html"],
    coverageDirectory: "../../coverage/apps/telegram-bot",
    testEnvironment: "node",
    preset: "../../jest.preset.js"
};
