// Site settings. Edit these, nothing else needs changing to go live.
window.SOUNDYARD = {
  // Google Sheet ID (from the sheet's URL). The sheet must be shared as
  // "anyone with the link can view" for the live site to read it.
  sheetId: "1b7fTB5lMdGYLyjZtWgRa6tgsRZQIN0QXD-nTVyZItKs",
  // Used when the sheet can't be read or has no header row yet.
  fallbackCsv: "data/stock.csv",
  currency: "GBP",
  locale: "en-GB",
  // TODO: set before going live
  contactEmail: "hello@example.com",
  location: "Hackney Wick, London",
  // Shown on items whose shipping cell is empty.
  defaultShipping: "Collection from Hackney Wick, London. Delivery quoted on request.",
};
