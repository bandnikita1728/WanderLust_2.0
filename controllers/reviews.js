const Listing = require("../models/listing");
const Review = require("../models/review");

const createReview = async (req, res) => {
  const { id } = req.params;
  const listing = await Listing.findById(id);
  const newReview = new Review(req.body.review);

  newReview.author = req.user ? req.user._id : "65c3b1740989f668393e8bf0";

  listing.reviews.push(newReview);

  await newReview.save();
  await listing.save();

  req.flash("success", "Review Added!");
  res.redirect(`/listings/${id}`);
};

const destroyReview = async (req, res) => {
  const { id, reviewId } = req.params;

  await Listing.findByIdAndUpdate(id, { $pull: { reviews: reviewId } });
  await Review.findByIdAndDelete(reviewId);

  req.flash("success", "Review Deleted!");
  res.redirect(`/listings/${id}`);
};

module.exports = {
  createReview,
  destroyReview,
};
