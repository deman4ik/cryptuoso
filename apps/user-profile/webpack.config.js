module.exports = function (config, context) {
    return {
        ...config,
        entry: {
            ...config.entry,
            encryptWorker: `${context.options.root}/${context.options.sourceRoot}/app/encryptWorker.ts`
        },
        output: {
            ...config.output,
            filename: "[name].js"
        }
    };
};
