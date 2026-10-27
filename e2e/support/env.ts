export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8080';

/// Bootstrap admin created by the API on first start (see the backend's .env.example).
export const ADMIN = {
    email:
        process.env.E2E_ADMIN_EMAIL ??
        process.env.TICKETING_BOOTSTRAP_ADMIN_EMAIL ??
        'admin@ticketing.local',
    password:
        process.env.E2E_ADMIN_PASSWORD ??
        process.env.TICKETING_BOOTSTRAP_ADMIN_PASSWORD ??
        'ChangeMe-Admin-2026!',
};

export const ADMIN_STORAGE_STATE = '.auth/admin.json';
