module.exports = {
    name: "stats-calc",
    preset: "../../jest.config.js",
    transform: {
        "^.+\\.[tj]sx?$": "ts-jest"
    },
    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "html"],
    coverageDirectory: "../../coverage/libs/stats-calc",
    verbose: true,
    globals: { "ts-jest": { tsConfig: "<rootDir>/tsconfig.spec.json" } }
};
