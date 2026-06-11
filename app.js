require("./utils/mongoMock"); // Patch mongoose to run seamlessly with an in-memory replica if local MongoDB is unreachable
require("dotenv").config();

// 1. requires
const express = require("express");
const app = express();
const mongoose = require("mongoose");
const path = require("path");
const ejsMate = require("ejs-mate");
const session = require("express-session");
const MongoStore = require("connect-mongo").MongoStore;
const flash = require("connect-flash");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const User = require("./models/user");
const methodOverride = require("method-override");
const ExpressError = require("./utils/ExpressError");
const listingRouter = require("./routes/listing");
const reviewRouter = require("./routes/review");

// 2. mongoose connect
let dbUrl = process.env.ATLASDB_URL || "mongodb://127.0.0.1:27017/wanderlust";
if (!dbUrl.startsWith("mongodb://") && !dbUrl.startsWith("mongodb+srv://")) {
  dbUrl = "mongodb://127.0.0.1:27017/wanderlust";
}
mongoose.connect(dbUrl)
  .then(() => {
    console.log("connected to DB");
  })
  .catch((err) => {
    console.error("Mongoose connection helper error:", err.message);
  });

// 3. app setup
app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(methodOverride("_method"));

// 4. session config
const secret = process.env.SECRET || "mysupersecretcode";
const store = MongoStore.create({
  mongoUrl: dbUrl,
  crypto: {
    secret: secret,
  },
  touchAfter: 24 * 3600,
});

store.on("error", (err) => {
  console.log("Mongo Store connection error recorded: database fallback is active.", err.message);
});

const sessionConfig = {
  store: store,
  secret: secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
  },
};

app.use(session(sessionConfig));

// 5. flash setup
app.use(flash());

// 6. passport initialize
app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

// 7. res.locals middleware
app.use((req, res, next) => {
  res.locals.currentUser = req.user || null;
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  next();
});

// Demo route to redirect root to /listings
app.get("/", (req, res) => {
  res.redirect("/listings");
});

// 8. mount routes
app.use("/listings", listingRouter);
app.use("/listings/:id/reviews", reviewRouter);

// 9. 404 handler
app.all("*", (req, res, next) => {
  next(new ExpressError(404, "Page Not Found!"));
});

// 10. error handler middleware
app.use((err, req, res, next) => {
  const { statusCode = 500, message = "Something went wrong" } = err;
  res.status(statusCode).render("error.ejs", { message });
});

const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});
