"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.requireTenant = requireTenant;
exports.requireRole = requireRole;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const index_js_1 = require("../config/index.js");
function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ code: 'UNAUTHORIZED', message: 'Authentication token required' });
        return;
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, index_js_1.config.jwtSecret);
        req.user = decoded;
        if (decoded.businessId) {
            req.businessId = decoded.businessId;
        }
        next();
    }
    catch (err) {
        res.status(401).json({ code: 'INVALID_TOKEN', message: 'Token is invalid or expired' });
        return;
    }
}
function requireTenant(req, res, next) {
    if (!req.user) {
        res.status(401).json({ code: 'UNAUTHORIZED', message: 'Authentication required' });
        return;
    }
    if (req.user.role === 'SUPER_ADMIN') {
        // If admin is inspecting a specific business via header or query param
        const overrideBiz = req.headers['x-business-id'] || req.query.businessId;
        if (overrideBiz) {
            req.businessId = overrideBiz;
        }
        next();
        return;
    }
    if (!req.user.businessId) {
        res.status(403).json({ code: 'TENANT_REQUIRED', message: 'Business tenancy context required' });
        return;
    }
    req.businessId = req.user.businessId;
    next();
}
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            res.status(403).json({
                code: 'FORBIDDEN',
                message: 'You do not have permission to perform this action',
            });
            return;
        }
        next();
    };
}
