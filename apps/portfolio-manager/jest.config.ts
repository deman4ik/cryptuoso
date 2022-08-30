/* eslint-disable */
export default {
    displayName: "portfolio-manager",

    globals: {
        "ts-jest": { tsconfig: "<rootDir>/tsconfig.spec.json" }
    },
    transform: {
        "^.+\\.[tj]s$": "ts-jest"
    },
    moduleFileExtensions: ["ts", "js", "html"],
    coverageDirectory: "../../coverage/apps/portfolio-manager",
    testEnvironment: "node",
    preset: "../../jest.preset.js"
};
