import Validator, { ValidationSchema } from "fastest-validator";
import { BaseError } from "@cryptuoso/errors";

const v = new Validator();

/**
 * Throws error if provided object does not match provided validation schema.
 * @param data
 * @param schema
 * @example
 * const Schema: ValidationSchema = {
 *       foo: "number",
 *       bar: "string",
 *       tar: { type: "object", optional: true }
 *   };
 * validate({foo: "bar", tar: 1}) // throws error;
 */
export function validate(data: Record<string, unknown>, schema: ValidationSchema): void {
    const validationErrors = v.validate(data, schema);
    if (Array.isArray(validationErrors)) {
        throw new BaseError(
            `${validationErrors.map((err) => err.message).join(" ")}`,
            { validationErrors },
            "VALIDATION"
        );
    }
}
