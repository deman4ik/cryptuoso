import { UserRoles } from "@cryptuoso/user-state";

function roleToAccesValue(role: UserRoles) {
    switch (role) {
        case UserRoles.anonymous:
            return 20;
        case UserRoles.user:
            return 15;
        case UserRoles.vip:
            return 10;
        case UserRoles.admin:
            return 5;
        default:
            return 20;
    }
}

export function getAccessValue(user: {
    roles: {
        allowedRoles: UserRoles[];
    };
}): number {
    const {
        roles: { allowedRoles }
    } = user;
    const accessValues = allowedRoles.map((role) => roleToAccesValue(role));
    return Math.min(...accessValues);
}
