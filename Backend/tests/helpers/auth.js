import jwt from "jsonwebtoken";

// Signs a token with the SAME shape verifyJWT expects — matches
// User.generateAccessToken() / Admin.generateAccessToken() exactly,
// without needing a live document's instance method.
export const signAccessToken = (doc, role) =>
  jwt.sign(
    { _id: doc._id, fullname: doc.fullname, email: doc.email, role },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRY },
  );

export const authHeader = (doc, role) => ({ Authorization: `Bearer ${signAccessToken(doc, role)}` });
