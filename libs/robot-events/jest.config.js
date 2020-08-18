module.exports = {
    name: "robot-events",
    preset: "../../jest.config.js",
    transform: {
        "^.+\\.[tj]sx?$": "ts-jest"
    },
    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "html"],
    coverageDirectory: "../../coverage/libs/robot-events",
    globals: { "ts-jest": { tsConfig: "<rootDir>/tsconfig.spec.json" } }
};
