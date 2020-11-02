module.exports = function (config, context) {
    return {
        ...config,
        entry: {
            ...config.entry,
            decryptWorker: `${context.options.root}/${context.options.sourceRoot}/app/decryptWorker.ts`
        },
        output: {
            ...config.output,
            filename: "[name].js"
        }
    };
};
