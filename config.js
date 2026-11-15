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
  siteUrl: "shop.psion.systems",
  // Google Forms the site posts to directly. Fill in from each form's
  // "Get pre-filled link" (the entry.123456 numbers). Left empty = feature hidden.
  // Guestbook responses go to a "guestbook" tab in the stock sheet (public).
  guestbookForm: { action: "", fields: { name: "", where: "", message: "" } },
  // Alert sign-ups must NOT go into the stock sheet: it's public, emails would leak.
  alertsForm: { action: "", fields: { email: "" } },
  // Shown on items whose shipping cell is empty.
  defaultShipping: "Collection from Hackney Wick, London. Delivery quoted on request.",
};
