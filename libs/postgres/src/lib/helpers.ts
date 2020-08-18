export const prepareUnnest = (arr: { [key: string]: any }[], fields: string[]): any[][] =>
    arr.map((item) => {
        const newItem: { [key: string]: any } = {};
        fields.forEach((field) => {
            newItem[field] = item[field];
        });
        return Object.values(newItem);
    });
