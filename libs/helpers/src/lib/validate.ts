import Validator, { ValidationSchema } from "fastest-validator";
import { BaseError } from "@cryptuoso/errors";

const v = new Validator();

function validate(data: object, schema: ValidationSchema): void {
    const validationErrors = v.validate(data, schema);
    if (Array.isArray(validationErrors)) {
        throw new BaseError(
            `${validationErrors.map((err) => err.message).join(" ")}`,
            { validationErrors },
            "VALIDATION"
        );
    }
}

export { validate };
