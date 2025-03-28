const axios = require("axios");
const User = require("../Schema/UserSchema");
const { encryptedToken, decryptedToken } = require("../utils/tokenSecurity");
const { createJwt } = require("../utils/jwtutility");
const getAccessToken = require("../utils/refreshToken");
const LinkedAccount = require("../Schema/LinkedAccountSchema");
const { addAccessTokenQueue } = require("../Queues/accessTokenQueue");
const redisClient = require("../Redis");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:5000/api/v1/auth/google/callback";
// console.log
// Step 1: Exchange auth code for tokens
module.exports.LoginUser = async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing auth code");
  try {
    const { data } = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      })
    );

    const { access_token } = data;
    const userInfo = await axios.get(
      `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${access_token}`
    );

    const user = userInfo.data;

    // find if the user exists
    const userExist = await User.findOne({ email: user.email });
    const refreshtoken = encryptedToken(data.refresh_token);

    if (!userExist) {
      const newUser = {
        fname: user.given_name,
        lname: user.family_name,
        email: user.email,
        refreshToken: refreshtoken,
        picture: user.picture,
      };

      await User.create(newUser);
    } else {
      await User.findByIdAndUpdate(userExist._id, {
        refreshToken: refreshtoken,
        picture: user.picture,
      });
    }

    // console.log(u);
    const jwt = createJwt({ email: user.email, access_token: access_token });
    // console.log(jwt);

    res.cookie("accesstoken", jwt, {
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    });

    res.redirect("http://localhost:5173/home");
  } catch (err) {
    console.log(err);
    console.error("Error in OAuth:", err.response?.data || err.message);
    res.status(500).send("OAuth Failed");
  }
};

module.exports.getUser = async function (req, res) {
  try {
    const email = req.email;
    let access_token = req.userId;

    const user = await User.findOne({ email: email }).select("-refreshToken");
    for (const element of user.linkedAccounts) {
      addAccessTokenQueue({ email: element.email });
    }
    await redisClient.set(`accesstoken:${email}`, access_token);
    await redisClient.expire(`accesstoken:${email}`, 900);

    res.status(200).json(user);
  } catch (error) {
    console.log(error);
  }
};

module.exports.addAccountRoute = function (req, res) {
  // console.log("is the request evern reaching to add account");
  const email = req.email;
  // console.log(email);
  return res.json({
    redirecturi: `https://accounts.google.com/o/oauth2/auth?client_id=125466525384-cdvft8moir56fj66b8jhmgn6lm52c82u.apps.googleusercontent.com&redirect_uri=http://localhost:5000/api/v1/auth/google/add-account&response_type=code&scope=email%20profile%20https://www.googleapis.com/auth/gmail.readonly&access_type=offline&prompt=consent&state=${encodeURIComponent(
      email
    )}`,
  });
};

const REDIRECT_URI_ADD_ACCOUNT =
  "http://localhost:5000/api/v1/auth/google/add-account";
module.exports.addAccount = async function (req, res) {
  const code = req.query.code;
  const mainEmail = req.query.state
    ? decodeURIComponent(req.query.state)
    : null;
  if (!code) return res.status(400).send("Missing auth code");
  if (!mainEmail) return res.status(400).send("Missing the main mail");
  try {
    const { data } = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI_ADD_ACCOUNT,
        grant_type: "authorization_code",
      })
    );

    const userInfo = await axios.get(
      `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${data.access_token}`
    );

    if (!userInfo) throw new Error("user doesn't exist");
    const updatedUser = await User.findOneAndUpdate(
      { email: mainEmail },
      { $addToSet: { linkedAccounts: { email: userInfo.data.email } } }
    );

    const refreshtoken = decryptedToken(updatedUser.refreshToken);
    const access_token = await getAccessToken(refreshtoken);

    const jwt = createJwt({
      email: updatedUser.email,
      access_token: access_token,
    });
    res.cookie("accesstoken", jwt, {
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    });
    // acc the user in the linked account collection
    const refreshToken = encryptedToken(data.refresh_token);
    const obj = {
      mainMail: updatedUser.email,
      linkedEmail: userInfo.data.email,
      refreshToken: refreshToken,
    };
    // console.log(obj);
    await LinkedAccount.create(obj);
    return res.redirect("http://localhost:5173/home");
  } catch (error) {
    console.log(error);
  }
};
