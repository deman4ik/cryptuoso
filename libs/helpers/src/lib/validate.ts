import Validator, { ValidationSchema } from "fastest-validator";
import { BaseError } from "@cryptuoso/errors";

const v = new Validator();

/**
 * Throws error if provided object does not match provided validation schema.
 * @param data
 * @param schema
 * @example
 */
export function validate(data: object, schema: ValidationSchema): void {
    const validationErrors = v.validate(data, schema);
    if (Array.isArray(validationErrors)) {
        throw new BaseError(
            `${validationErrors.map((err) => err.message).join(" ")}`,
            { validationErrors },
            "VALIDATION"
        );
    }
}
