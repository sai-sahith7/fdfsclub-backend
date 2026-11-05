const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth2").Strategy;
const {
  Strategy: JwtStrategy,
  ExtractJwt,
} = require("passport-jwt");
const User = require("../models/User");
const { JWT_ALGORITHM } = require("../utils/generateToken");
const { CookieStateStore } = require("./oauthStateStore");

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      passReqToCallback: true,
      store: new CookieStateStore(),
    },
    async (request, accessToken, refreshToken, profile, done) => {
      try {
        const email = typeof profile?.email === "string" ? profile.email.trim().toLowerCase() : "";
        if (!email || profile.email_verified === false || profile.verified === false) {
          return done(null, false);
        }

        let user = await User.findOne({ email });

        if (!user) {
          user = await User.create({
            email,
            name: profile.displayName || email.split("@")[0],
            image_url: profile.picture || null,
          });
        }

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

const jwtOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET,
  algorithms: [JWT_ALGORITHM],
};

passport.use(
  new JwtStrategy(jwtOptions, async (jwtPayload, done) => {
    try {
      const user = await User.findOne({ email: jwtPayload.email });
      if (user) return done(null, user);
      return done(null, false);
    } catch (err) {
      return done(err, false);
    }
  })
);

module.exports = passport;
