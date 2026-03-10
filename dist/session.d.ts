export interface AuthInfo {
    email: string;
    loggedInAt: string;
    name?: string;
}
export interface StoreInfo {
    storeId: string;
    storeName: string;
    address: string;
    setAt: string;
}
export declare function ensureSessionDir(): void;
export declare function saveCookies(cookies: unknown[]): void;
export declare function loadCookies(): unknown[] | null;
export declare function clearCookies(): void;
export declare function saveAuth(info: AuthInfo): void;
export declare function loadAuth(): AuthInfo | null;
export declare function isLoggedIn(): boolean;
export declare function saveStore(info: StoreInfo): void;
export declare function loadStore(): StoreInfo | null;
export declare function getSessionDir(): string;
//# sourceMappingURL=session.d.ts.map