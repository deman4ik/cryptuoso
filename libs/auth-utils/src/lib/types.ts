export interface Bcrypt {
    compare: { (data: any, encrypted: string): Promise<boolean> };
    hash: { (data: any, saltOrRounds: string | number): Promise<string> };
}
