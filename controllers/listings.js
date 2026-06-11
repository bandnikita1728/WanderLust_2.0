const Listing = require("../models/listing");

const index = async (req, res) => {
  const allListings = await Listing.find({});
  res.render("listings/index", { allListings });
};

const renderNewForm = (req, res) => {
  res.render("listings/new");
};

const createListing = async (req, res) => {
  const newListing = new Listing(req.body.listing);
  // Guarantee owner exists
  newListing.owner = req.user ? req.user._id : "65c3b1740989f668393e8bf0";

  // Use req.file if uploaded, otherwise use placeholder as instructed
  if (req.file) {
    newListing.image = {
      url: req.file.path,
      filename: req.file.filename,
    };
  } else {
    newListing.image = {
      url: "https://images.unsplash.com/photo-1540555700478-4be289fbecef?q=80&w=1000",
      filename: "listingimage",
    };
  }

  await newListing.save();
  req.flash("success", "New Listing Created!");
  res.redirect(`/listings/${newListing._id}`);
};

const showListing = async (req, res) => {
  const { id } = req.params;
  const listing = await Listing.findById(id)
    .populate({
      path: "reviews",
      populate: {
        path: "author",
      },
    })
    .populate("owner");

  if (!listing) {
    req.flash("error", "Listing you requested for does not exist!");
    return res.redirect("/listings");
  }
  res.render("listings/show", { listing });
};

const renderEditForm = async (req, res) => {
  const { id } = req.params;
  const listing = await Listing.findById(id);
  if (!listing) {
    req.flash("error", "Listing you requested for does not exist!");
    return res.redirect("/listings");
  }
  res.render("listings/edit", { listing });
};

const updateListing = async (req, res) => {
  const { id } = req.params;
  const listing = await Listing.findByIdAndUpdate(id, { ...req.body.listing }, { new: true });

  if (req.file) {
    listing.image = {
      url: req.file.path,
      filename: req.file.filename,
    };
    await listing.save();
  }

  req.flash("success", "Listing Updated!");
  res.redirect(`/listings/${id}`);
};

const destroyListing = async (req, res) => {
  const { id } = req.params;
  await Listing.findByIdAndDelete(id);
  req.flash("success", "Listing Deleted!");
  res.redirect("/listings");
};

module.exports = {
  index,
  renderNewForm,
  createListing,
  showListing,
  renderEditForm,
  updateListing,
  destroyListing,
};
