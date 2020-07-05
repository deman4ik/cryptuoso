/**
 * Функция форматирования html
 * @param htmlStr
 */
export const formatHTML = (htmlStr: string): string => {
    return htmlStr.replace(/(?:\r\n|\r|\n)/g, "<br />");
};
