module.exports = {
    displayName: "user-robot-runner",
    preset: "../../jest.preset.js",
    globals: {
        "ts-jest": {
            tsConfig: "<rootDir>/tsconfig.spec.json"
        }
    },
    transform: {
        "^.+\\.[tj]s$": "ts-jest"
    },
    moduleFileExtensions: ["ts", "js", "html"],
    coverageDirectory: "../../coverage/apps/user-robot-runner"
};