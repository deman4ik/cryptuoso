export default {
    displayName: "portfolio-state",

    globals: {
        "ts-jest": { tsconfig: "<rootDir>/tsconfig.spec.json" }
    },
    transform: {
        "^.+\\.[tj]sx?$": "ts-jest"
    },
    moduleFileExtensions: ["ts", "tsx", "js", "jsx"],
    coverageDirectory: "../../coverage/libs/portfolio-state",
    preset: "../../jest.preset.js"
};
