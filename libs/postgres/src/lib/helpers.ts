import { DatabasePoolType, sql, TaggedTemplateLiteralInvocationType } from "slonik";

export const prepareUnnest = (arr: { [key: string]: any }[], fields: string[]): any[][] =>
    arr.map((item) => {
        const newItem: { [key: string]: any } = {};
        fields.forEach((field) => {
            newItem[field] = item[field] === undefined ? null : item[field];
        });
        return Object.values(newItem);
    });

export type QueryType = TaggedTemplateLiteralInvocationType/* SqlSqlTokenType<QueryResultRowType<any>> */;

export const makeChunksGenerator = (pg: DatabasePoolType, query: QueryType, chunkSize = 500) => {
    if (!chunkSize || chunkSize < 1) throw new Error("Argument 'chunkSize' must be positive number.");

    return async function* () {
        let chunkNum = 0;

        while (true) {
            const chunk = await pg.any<any>(sql`
                    ${query}
                    LIMIT ${chunkSize} OFFSET ${chunkNum * chunkSize};
                `);

            ++chunkNum;

            if (chunk.length > 0) yield chunk;
            if (chunk.length != chunkSize) break;
        }
    };
};
