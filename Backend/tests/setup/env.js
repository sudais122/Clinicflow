// Runs before any test module is evaluated (registered under Jest's
// `setupFiles`). Sets the env vars every model/controller reads via
// process.env at call time (jwt secrets, expiries).
process.env.ACCESS_TOKEN_SECRET = "test-access-secret";
process.env.REFRESH_TOKEN_SECRET = "test-refresh-secret";
process.env.ACCESS_TOKEN_EXPIRY = "1h";
process.env.REFRESH_TOKEN_EXPIRY = "7d";
process.env.NODE_ENV = "test";
