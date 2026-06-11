const express = require("express");
const router = express.Router({ mergeParams: true });
const { wrapAsync, validateReview, isLoggedIn, isReviewAuthor } = require("../middlewares");
const { createReview, destroyReview } = require("../controllers/reviews");

router.post("/", isLoggedIn, validateReview, wrapAsync(createReview));

router.delete("/:reviewId", isLoggedIn, isReviewAuthor, wrapAsync(destroyReview));

module.exports = router;
