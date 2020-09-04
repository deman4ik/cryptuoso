module.exports = function (config, context) {
    return {
        ...config,
        entry: {
            ...config.entry,
            statsWorker: `${context.options.root}/${context.options.sourceRoot}/app/statsWorker.ts`
        },
        output: {
            ...config.output,
            filename: "[name].js"
        }
    };
};
