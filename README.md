# Tipping Point

A turn-based island strategy game for browser + iOS. Grow a settlement from 120 islanders to 1,500 —
but every power choice feeds a carbon simulation, and the consequences arrive on a delay.

The climate teaching is entirely indirect, baked into the mechanics:

| Mechanic                                                    | Real-world concept                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| Temperature chases CO₂ with a lag (~18%/turn)              | Committed warming — by the time you feel it, more is coming    |
| Ocean absorbs less CO₂ as it warms                         | Weakening carbon sinks                                          |
| Wildfires destroy forests**and** release their carbon | Feedback loops / tipping cascades                               |
| Coal: cheapest, most powerful, delayed cost                 | Fossil lock-in economics                                        |
| Sea floods low tiles at temperature thresholds              | Sea-level rise, coastal risk                                    |
| "Clear" tool lets you retire coal, forests draw down slowly | Transition + drawdown are possible but slow                     |
| World CO₂ drift you can't control                          | You're not the only emitter — but sinks you build still matter |

Nothing in the game says "climate change." The sea just remembers what you burn.

## Structure

```
index.html      landing page (marketing / press kit)
teachers.html   printable classroom guide (NGSS + APES alignment)
play/           the game — plain HTML/CSS/JS + Canvas, zero dependencies
```

## Run locally

```
npx -y serve . -l 5757
```

- http://localhost:5757 — landing page
- http://localhost:5757/play — the game
- http://localhost:5757/teachers.html — classroom guide

No build step, no dependencies.

## Deploy to GitHub Pages (free hosting)

```
gh repo create tipping-point --public --source . --push
gh api -X POST "repos/{owner}/tipping-point/pages" -f "source[branch]=main" -f "source[path]=/"
```

Site appears at `https://dustinrathke.github.io/tipping-point/` within a few minutes.

**After deploying:** replace the `YOURUSERNAME` placeholder in `teachers.html` with the real
URL, commit, and push again.

## Design targets

- Portrait, one-thumb play, sessions ~10–20 min
- Perfect play wins around turn 24; typical wins 30–40 turns
- Win: 1,500 pop at ≤ +1.6°. Lose: +2.6° runaway, population 0, or island drowned
- Tuning constants all live in `SIM` at the top of `play/game.js`

## Path to the App Store

1. **Apple Developer Program** — $99/year, required for any App Store listing.
   Enroll at developer.apple.com (individual account is fine for a solo paid app).
2. **Wrap with Capacitor** (turns the web app into a native iOS app):
   ```
   npm init -y
   npm i @capacitor/core @capacitor/cli @capacitor/ios
   npx cap init "Tipping Point" com.yourname.tippingpoint --web-dir play
   npx cap add ios
   ```
3. **Build/sign on a Mac** — the one step Windows can't do. Options, cheapest first:
   - **Codemagic** free tier (~500 macOS build minutes/month) — CI builds + uploads to
     App Store Connect from a git repo; no Mac needed.
   - GitHub Actions macOS runners (private repos burn minutes at 10×).
   - A used Mac mini if this becomes a habit.
4. **App Store Connect** — create the app listing, upload via CI, submit for review.
   Screenshots for 6.7" and 6.5" iPhones required; the game's portrait layout makes these easy.

### Before shipping (not yet done)

- App icon + launch screen
- Sound (optional but reviews notice)
- A short 3-step interactive tutorial (first-run overlay exists; hand-holding converts better)
- Check the name — "Tipping Point" may collide on the App Store; alternates: *High Ground*, *One Warm Sea*, *Islanders*
- Privacy: game stores only localStorage locally, so the privacy questionnaire is all "no" — easy
- Pricing: $2.99, with the App Store Connect education volume discount enabled (50% off for schools buying 20+)

## Go-to-market

The free browser build is the sales force; the iOS app is the product. Sequence:

1. Deploy this site (above) — free web version is the thing teachers and media will actually share
2. Submit the web version to **SubjectToClimate** and **CLEAN (cleanet.org)** resource indexes
3. Post the classroom guide in AP Environmental Science teacher groups (July–Aug = fall curriculum planning)
4. Submit to **Games for Change** (games4change.org)
5. Pitch climate media (The Cool Down, Grist, Yale Climate Connections) with App Store promo codes attached
6. Consumer pushes timed to NYC Climate Week (late Sept) and Earth Day (Apr 22)
