import { expose } from "threads/worker";
import bcrypt from "bcrypt";

const compare = (data: any, encrypted: string): Promise<boolean> => bcrypt.compare(data, encrypted);
const hash = (data: any, saltOrRounds: string | number): Promise<string> => bcrypt.hash(data, saltOrRounds);

const bcryptUtils = {
    compare,
    hash
};

export type BcryptUtils = typeof bcryptUtils;

expose(bcryptUtils);
