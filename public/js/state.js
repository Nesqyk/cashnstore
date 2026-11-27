// Who is signed in, and what they may do. Set by main.js, read by the screens.
export const session = { user: null, store: null };
export const can = (code) => !!session.user && session.user.permissions.includes(code);
export const canAny = (...codes) => codes.some(can);
export const isOwner = () => !!session.user && session.user.role === 'owner';
