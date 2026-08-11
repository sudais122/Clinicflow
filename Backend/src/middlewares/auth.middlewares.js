const verifyJWT = async (req, res, next) => {
  try {
    const token =
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", "");

    console.log("ACCESS TOKEN EXISTS:", !!token);

    if (!token) {
      throw new ApiError(401, "Unauthorized request");
    }

    const decodedToken = jwt.verify(
      token,
      process.env.ACCESS_TOKEN_SECRET
    );

    console.log("DECODED TOKEN:", decodedToken);

    const user = await User.findById(decodedToken._id).select(
      "-password -refreshToken"
    );

    console.log("USER FOUND:", !!user);

    if (!user) {
      throw new ApiError(401, "Invalid access token");
    }

    req.user = user;

    next();
  } catch (error) {
    console.log("VERIFY JWT ERROR:", error.message);

    next(
      new ApiError(
        401,
        error?.message || "Invalid access token"
      )
    );
  }
};
 export {verifyJWT}