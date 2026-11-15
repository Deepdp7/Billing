"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const shops_js_1 = require("./shops.js");
(0, shops_js_1.initShops)();
/**
 * The database of the business the current request belongs to (see shops.ts): every module keeps using `db` as
 * before, and each call goes to the right business's file.
 */
exports.db = new Proxy({}, {
    get(_target, prop) {
        const real = (0, shops_js_1.currentShop)().db;
        const value = real[prop];
        return typeof value === 'function' ? value.bind(real) : value;
    },
    set(_target, prop, value) {
        (0, shops_js_1.currentShop)().db[prop] = value;
        return true;
    },
});
