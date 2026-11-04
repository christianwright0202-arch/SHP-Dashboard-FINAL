// VERIFIED demand-driving events for the SHP markets, 2025–2026 (+ early 2027 where known).
// Markets: "Arlington" (The Rambler Inn, walk to AT&T Stadium / near Globe Life Field) and
// "Fort Worth" (Hotel SOMA). Dates were verified against official sources by research done on
// 2026-11-04; `confirmed:false` marks dates that came only from ticket aggregators or lacked a
// second source. `source` is a representative citation. Impact: high | med | low.
//
// Deliberately EXCLUDED after verification:
//   - Cowboys "home" game 2026-09-27 vs Baltimore — played in Rio de Janeiro, not Arlington.
//   - Stevie Nicks "2026-04-18 Globe Life Field" — actually WinStar (Thackerville, OK).
//   - Savannah Bananas / Kanye / Garth Brooks etc. at AT&T — unconfirmed venue/date.
// Schema: { date, endDate?, name, venue, market, category, impact, confirmed?, source }

const S = {
  cowboys25: "https://en.wikipedia.org/wiki/2025_Dallas_Cowboys_season",
  cowboys26: "https://www.dallascowboys.com/news/nfl-announces-cowboys-2026-complete-17-game-schedule",
  wc: "https://www.arlingtontx.gov/News-Articles/2025/December/Final-Match-Schedule-for-the-FIFA-World-Cup-2026-in-Arlington",
  att: "https://www.arlington.org/plan/blog/post/2026-major-events-arlington-texas/",
  glf: "https://globelifefield.com/stadium-events/",
  rangers25: "https://www.baseball-reference.com/teams/TEX/2025-schedule-scores.shtml",
  rangers26: "https://www.baseball-reference.com/teams/TEX/2026-schedule-scores.shtml",
  fwssr: "https://www.fwssr.com/",
  tcu25: "https://gofrogs.com/news/2025/2/4/tcus-2025-football-schedule-announced",
  tcu26: "https://en.wikipedia.org/wiki/2026_TCU_Horned_Frogs_football_team",
  dickies: "https://en.wikipedia.org/wiki/Dickies_Arena",
  fwfest: "https://fwtx.com/",
};

// ---- Arlington: Dallas Cowboys home games (AT&T Stadium) ----
const cowboys = [
  ["2025-08-16", "Ravens", "preseason"], ["2025-08-22", "Falcons", "preseason"],
  ["2025-09-14", "Giants"], ["2025-09-28", "Packers"], ["2025-10-19", "Commanders"],
  ["2025-11-03", "Cardinals"], ["2025-11-23", "Eagles"], ["2025-11-27", "Chiefs (Thanksgiving)"],
  ["2025-12-14", "Vikings"], ["2025-12-21", "Chargers"],
  ["2026-08-28", "Saints", "preseason"],
  ["2026-09-20", "Commanders"], ["2026-10-08", "Buccaneers"], ["2026-11-01", "Cardinals"],
  ["2026-11-15", "49ers"], ["2026-11-22", "Titans"], ["2026-11-26", "Eagles (Thanksgiving)"],
  ["2026-12-27", "Jaguars"], ["2027-01-03", "Giants"],
].map(([date, opp, type]) => ({
  date, name: `Cowboys vs ${opp}`, venue: "AT&T Stadium", market: "Arlington",
  category: "nfl", impact: type === "preseason" ? "med" : "high",
  source: date < "2026-01-01" ? S.cowboys25 : S.cowboys26,
}));

// ---- Arlington: FIFA World Cup 2026 (AT&T Stadium, "Dallas Stadium") ----
const worldCup = [
  ["2026-06-14", "Group Stage"], ["2026-06-17", "Group Stage"], ["2026-06-22", "Group Stage"],
  ["2026-06-25", "Group Stage"], ["2026-06-27", "Group Stage"], ["2026-06-30", "Round of 32"],
  ["2026-07-03", "Round of 32"], ["2026-07-06", "Round of 16"], ["2026-07-14", "Semifinal"],
].map(([date, round]) => ({
  date, name: `FIFA World Cup — ${round}`, venue: "AT&T Stadium", market: "Arlington",
  category: "worldcup", impact: "high", source: S.wc,
}));

// ---- Arlington: other major AT&T Stadium events ----
const attEvents = [
  { date: "2025-04-14", name: "AC/DC — Power Up Tour", impact: "high", confirmed: false },
  { date: "2025-05-09", name: "Post Malone", impact: "high" },
  { date: "2025-08-27", endDate: "2025-08-28", name: "The Weeknd", impact: "high" },
  { date: "2025-12-06", name: "Big 12 Championship Game", impact: "high" },
  { date: "2025-12-31", name: "Goodyear Cotton Bowl (CFP Quarterfinal)", impact: "high" },
  { date: "2026-04-24", endDate: "2026-04-26", name: "Lone Star Smokeout Festival", impact: "med" },
  { date: "2026-08-16", name: "BTS", impact: "high" },
  { date: "2026-08-22", endDate: "2026-08-23", name: "Zach Bryan", impact: "high", confirmed: false },
  { date: "2026-09-10", name: "Usher", impact: "high", confirmed: false },
  { date: "2026-10-24", name: "Ed Sheeran", impact: "high" },
  { date: "2026-12-04", name: "Big 12 Championship Game", impact: "high" },
].map((e) => ({ venue: "AT&T Stadium", market: "Arlington", category: "att-event", source: S.att, ...e }));

// ---- Arlington: Globe Life Field concerts & non-baseball events ----
const globeLife = [
  { date: "2025-04-11", name: "Riley Green / Bailey Zimmerman", impact: "high" },
  { date: "2025-06-06", endDate: "2025-06-07", name: "Stray Kids", impact: "high" },
  { date: "2025-06-11", name: "Shakira", impact: "high" },
  { date: "2025-07-12", name: "AEW All In: Texas", impact: "high" },
  { date: "2025-08-02", name: "My Chemical Romance", impact: "high" },
  { date: "2025-08-16", name: "ATEEZ", impact: "med" },
  { date: "2025-09-02", endDate: "2025-09-03", name: "Chris Brown", impact: "high" },
  { date: "2026-05-16", name: "Eagles — The Long Goodbye", impact: "high" },
  { date: "2026-07-30", name: "Noah Kahan", impact: "high" },
  { date: "2026-07-31", name: "Fuerza Regida", impact: "high" },
  { date: "2026-08-01", name: "Forrest Frank", impact: "med" },
  { date: "2026-09-09", name: "Guns N' Roses", impact: "high" },
  { date: "2026-11-07", name: "The Big Dill — Pickle Party", impact: "low" },
  { date: "2026-11-20", endDate: "2026-12-23", name: "Texas Christkindl Market", impact: "low" },
  { date: "2026-12-29", endDate: "2026-12-31", name: "Passion 2027 Conference", impact: "med" },
].map((e) => ({ venue: "Globe Life Field", market: "Arlington", category: "glf-event", source: S.glf, ...e }));

// ---- Arlington: Texas Rangers home series (Globe Life Field), as homestand ranges ----
const rangersHomestands = [
  ["2025-03-27", "2025-03-30", "Red Sox (Opening Day)", "high"],
  ["2025-04-04", "2025-04-06", "Rays", "med"],
  ["2025-04-15", "2025-04-20", "Angels / Dodgers", "high"],
  ["2025-04-28", "2025-05-04", "Athletics / Mariners", "med"],
  ["2025-05-12", "2025-05-18", "Rockies / Astros", "high"],
  ["2025-05-26", "2025-06-01", "Blue Jays / Cardinals", "med"],
  ["2025-06-13", "2025-06-19", "White Sox / Royals", "med"],
  ["2025-06-27", "2025-07-02", "Mariners / Orioles", "med"],
  ["2025-07-18", "2025-07-27", "Tigers / Athletics / Braves", "med"],
  ["2025-08-04", "2025-08-13", "Yankees / Phillies / D-backs", "high"],
  ["2025-08-22", "2025-08-27", "Guardians / Angels", "med"],
  ["2025-09-05", "2025-09-10", "Astros / Brewers", "high"],
  ["2025-09-19", "2025-09-25", "Marlins / Twins", "med"],
  ["2026-04-03", "2026-04-08", "Reds / Mariners (Home Opener)", "high"],
  ["2026-04-21", "2026-04-29", "Pirates / Athletics / Yankees", "high"],
  ["2026-05-08", "2026-05-13", "Cubs / D-backs", "high"],
  ["2026-05-25", "2026-05-31", "Astros / Royals", "high"],
  ["2026-06-05", "2026-06-07", "Guardians", "med"],
  ["2026-06-15", "2026-06-21", "Twins / Padres", "med"],
  ["2026-07-02", "2026-07-12", "Tigers / Angels / Astros", "high"],
  ["2026-07-20", "2026-07-27", "White Sox / Mariners", "med"],
  ["2026-08-03", "2026-08-09", "Giants / Orioles", "med"],
  ["2026-08-18", "2026-08-23", "Nationals / Angels", "med"],
  ["2026-08-31", "2026-09-06", "Athletics / Rays", "med"],
  ["2026-09-15", "2026-09-24", "Red Sox / Blue Jays / Mets", "med"],
].map(([date, endDate, opp, impact]) => ({
  date, endDate, name: `Rangers homestand — ${opp}`, venue: "Globe Life Field", market: "Arlington",
  category: "mlb", impact, source: date < "2026-01-01" ? S.rangers25 : S.rangers26,
}));

// ---- Fort Worth: Stock Show & Rodeo (Will Rogers Memorial Center / Dickies Arena) ----
const stockShow = [
  { date: "2025-01-17", endDate: "2025-02-08", name: "Fort Worth Stock Show & Rodeo" },
  { date: "2026-01-16", endDate: "2026-02-07", name: "Fort Worth Stock Show & Rodeo" },
  { date: "2027-01-15", endDate: "2027-02-06", name: "Fort Worth Stock Show & Rodeo", confirmed: false },
].map((e) => ({ venue: "Will Rogers Memorial Center", market: "Fort Worth", category: "festival", impact: "high", source: S.fwssr, ...e }));

// ---- Fort Worth: TCU football home games (Amon G. Carter Stadium) ----
const tcu = [
  ["2025-09-13", "Abilene Christian"], ["2025-09-20", "SMU"], ["2025-10-04", "Colorado"],
  ["2025-10-18", "Baylor"], ["2025-11-08", "Iowa State"], ["2025-11-29", "Cincinnati"],
  ["2026-09-12", "Grambling State"], ["2026-09-19", "Arkansas State"], ["2026-10-03", "BYU"],
  ["2026-10-24", "West Virginia"], ["2026-10-31", "Kansas"], ["2026-11-14", "Kansas State"], ["2026-11-21", "Utah"],
].map(([date, opp]) => ({
  date, name: `TCU football vs ${opp}`, venue: "Amon G. Carter Stadium", market: "Fort Worth",
  category: "ncaaf", impact: "med", source: date < "2026-01-01" ? S.tcu25 : S.tcu26,
}));

// ---- Fort Worth: Dickies Arena concerts & events ----
const dickies = [
  { date: "2025-02-15", name: "Alan Jackson", impact: "med" },
  { date: "2025-03-09", endDate: "2025-03-16", name: "AAC Basketball Championships", impact: "med" },
  { date: "2025-03-27", name: "Rascal Flatts", impact: "med" },
  { date: "2025-04-17", endDate: "2025-04-19", name: "NCAA Women's Gymnastics Championships", impact: "med" },
  { date: "2025-04-26", name: "Disturbed", impact: "med" },
  { date: "2025-05-07", name: "Billy Idol", impact: "med" },
  { date: "2025-06-13", name: "Wu-Tang Clan", impact: "med" },
  { date: "2025-09-13", name: "Nine Inch Nails", impact: "med" },
  { date: "2025-10-09", name: "Keith Urban", impact: "high" },
  { date: "2025-12-21", endDate: "2025-12-22", name: "Pentatonix", impact: "med" },
  { date: "2026-02-27", name: "Eric Church", impact: "high" },
  { date: "2026-02-28", endDate: "2026-03-01", name: "Lady Gaga — The Mayhem Ball", impact: "high" },
  { date: "2026-03-10", name: "Conan Gray", impact: "med" },
  { date: "2026-05-07", name: "Florence + the Machine", impact: "med" },
  { date: "2026-07-30", name: "Meghan Trainor", impact: "med" },
  { date: "2026-09-15", endDate: "2026-09-20", name: "RLCS World Championship (esports)", impact: "med" },
  { date: "2026-10-16", name: "Gorillaz", impact: "high" },
  { date: "2026-11-07", name: "John Summit", impact: "med", confirmed: false },
  { date: "2026-12-12", name: "Matt Rife", impact: "med", confirmed: false },
].map((e) => ({ venue: "Dickies Arena", market: "Fort Worth", category: "concert", source: S.dickies, ...e }));

// ---- Fort Worth: major downtown festivals ----
const fwFestivals = [
  { date: "2025-04-03", endDate: "2025-04-06", name: "Fort Worth Food + Wine Festival", confirmed: false },
  { date: "2025-04-10", endDate: "2025-04-13", name: "Main St. Fort Worth Arts Festival" },
  { date: "2025-05-01", endDate: "2025-05-04", name: "Mayfest" },
  { date: "2026-04-09", endDate: "2026-04-12", name: "Fort Worth Food + Wine Festival" },
  { date: "2026-04-16", endDate: "2026-04-19", name: "Main St. Fort Worth Arts Festival" },
  { date: "2026-04-30", endDate: "2026-05-03", name: "Mayfest" },
].map((e) => ({ venue: "Downtown Fort Worth", market: "Fort Worth", category: "festival", impact: "med", source: S.fwfest, ...e }));

export const EVENTS = [
  ...cowboys, ...worldCup, ...attEvents, ...globeLife, ...rangersHomestands,
  ...stockShow, ...tcu, ...dickies, ...fwFestivals,
].map((e) => ({ confirmed: true, ...e })).sort((a, b) => a.date.localeCompare(b.date));

export default EVENTS;
