const express = require("express");
const router = express.Router();
const { wrapAsync, isLoggedIn, isOwner, validateListing } = require("../middlewares");
const {
  index,
  renderNewForm,
  createListing,
  showListing,
  renderEditForm,
  updateListing,
  destroyListing,
} = require("../controllers/listings");

router.route("/")
  .get(wrapAsync(index))
  .post(isLoggedIn, validateListing, wrapAsync(createListing));

router.route("/new")
  .get(isLoggedIn, renderNewForm);

router.route("/:id")
  .get(wrapAsync(showListing))
  .put(isLoggedIn, isOwner, validateListing, wrapAsync(updateListing))
  .delete(isLoggedIn, isOwner, wrapAsync(destroyListing));

router.route("/:id/edit")
  .get(isLoggedIn, isOwner, wrapAsync(renderEditForm));

module.exports = router;
