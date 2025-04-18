const jwt = require("jsonwebtoken");
const secretKey = process.env.JWT_SECRET_KEY;
module.exports.verifytoken = function (access_token) {
  if (!access_token) throw new Error("Access denied");
  try {
    const decoded = jwt.verify(access_token, secretKey);
    return decoded;
  } catch (err) {
    throw new Error("Invalid token");
  }
};

module.exports.createJwt = function (payload) {
  return jwt.sign(payload, secretKey);
};
