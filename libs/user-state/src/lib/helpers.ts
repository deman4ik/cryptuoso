import { UserRoles, UserAccessValues, User } from "./user-state";

function roleToAccesValue(role: UserRoles) {
    switch (role) {
        case UserRoles.anonymous:
            return UserAccessValues.anonymous;
        case UserRoles.user:
            return UserAccessValues.user;
        case UserRoles.vip:
            return UserAccessValues.vip;
        case UserRoles.admin:
            return UserAccessValues.admin;
        default:
            return UserAccessValues.anonymous;
    }
}

export function getAccessValue(user: User): number {
    const {
        roles: { allowedRoles, defaultRole }
    } = user;
    if (allowedRoles && Array.isArray(allowedRoles) && allowedRoles.length > 0) {
        const accessValues = allowedRoles.map((role) => roleToAccesValue(role));
        return Math.min(...accessValues);
    } else return roleToAccesValue(defaultRole);
}
