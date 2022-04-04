import { DatabasePool, sql, TaggedTemplateLiteralInvocation } from "slonik";
import { nvl } from "@cryptuoso/helpers";

export const prepareUnnest = (arr: { [key: string]: any }[], fields: string[]): any[][] =>
    arr.map((item) => {
        const newItem: { [key: string]: any } = {};
        fields.forEach((field) => {
            newItem[field] = nvl(item[field]);
            if (typeof item[field] === "object") newItem[field] = JSON.stringify(item[field]);
        });
        return Object.values(newItem);
    });

export type QueryType = TaggedTemplateLiteralInvocation;

export const makeChunksGenerator = (pg: DatabasePool, query: QueryType, chunkSize = 500) => {
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
