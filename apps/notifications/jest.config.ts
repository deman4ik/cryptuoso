/* eslint-disable */
export default {
    displayName: "notifications",

    globals: {
        "ts-jest": {
            tsconfig: "<rootDir>/tsconfig.spec.json"
        }
    },
    transform: {
        "^.+\\.[tj]s$": "ts-jest"
    },
    moduleFileExtensions: ["ts", "js", "html"],
    coverageDirectory: "../../coverage/apps/notifications",
    testEnvironment: "node",
    preset: "../../jest.preset.js"
};
