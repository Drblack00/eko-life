# Reference audit — lagoslife.app home screen & full UI (2026-10-12)

Method: live logged-in session (@Drblack0), pure observation — nothing bought, spent, sent, or changed. All behavior below was directly observed, not assumed. Rebuild patterns only with original code, text, and assets.

## A. Home screen layout

- 3D isometric dollhouse room (Sims-style) on a floating plot.
- **Top status pill (left → right):** in-game date/time (e.g. "Mon 12 · 6:01 AM", ticks in real time) · mood label (e.g. "Happy") · visits/online ("35.5m · 14k online") · music speaker toggle · wallet balance + green "+" top-up button.
- **Left floating cards:** goals card ("Buy something new — Open Buy and place an item"), daily gem hunt card ("8080 found · next prize ₦3,000"), "Clean screen" toggle.
- **Center:** 3D room — drag rotates/zooms; furniture, avatar by the door.
- **Bottom-left:** circular avatar button + needs pill with 6 bars (hunger, energy, fun, social, hygiene, bladder).
- **Bottom-center nav pill:** Home (selected), Buy, Map, Phone.
- **Bottom-right:** "Go to work" pill (or "Next shift Today 9:00 AM at CcHub") + travel pill ("By Danfo · ₦150 · change"); round buttons: keyboard shortcuts, camera/rotate.
- Dismissible green governor pill floats top-center ("Gov @Wealthynil: All hail WEALTHYNIL").

## B. Top buttons — each tapped, behavior observed

1. **Date/mood/online** — static, not clickable.
2. **Music toggle** — flips music on/off; state restored after test.
3. **Wallet "+"** — "Top up wallet" dialog: balance display, Pay-in radio ₦ Naira (checked) / $ USD, 4 packs (Jollof +₦50,000 ≈ ₦1,000/$1; Owambe +₦300,000 ≈ ₦5,000/$4; Big boy +₦700,000 ≈ ₦10,000/$7 "best value"; Odogwu +₦1,600,000 ≈ ₦20,000/$14); footer "Secure payment by Flutterwave · card, bank transfer or USSD". Closed without buying.
4. **Goals card** → opens character panel at Goals tab.
5. **Daily gem hunt card** → dialog: "New gem in 18h 14m", TODAY'S CLUE (riddle text), prize ladder (1st ₦50k / 2nd–3rd ₦25k / 4th–10th ₦10k / after ₦3,000), "found it today" count + first-finder usernames.
6. **Clean screen** → hides all UI except the top pill; "Show the menu" restores.
7. **Avatar button** → character dialog, 7 tabs:
   - **Profile:** 3D avatar ("Drag to spin"); username + Change; My CV; display-name textbox; masked email; house link (lagoslife.app/v/username) + share-house-link button; Body Woman/Man; Hairstyle (Low cut/Bald/Curls/Afro/Locs/Braids/Classic); Outfit (Casual/Hoodie/Office/Chill/Site work); Fabric (Plain/Ankara/Adire/Aso-oke); 14 skin tones; 10 outfit colours; 10 bottom colours; save disabled until changes ("No changes yet").
   - **Needs:** 6 need percentages; FEELINGS line ("Nothing beats a good bath."); status line ("Soft Life — Money dey. Enjoyment dey. Life is sweet."); traits (e.g. Tech Bro or Sis, Musical).
   - **Goals:** "Today's Hustle" (daily reward state, missions x/3, rank/rep); LIFETIME DREAM ("Oga at the Top — Reach the top level of any career.", 0%, "Change dream (once a week)"); LAPO loan (₦72,000 left · ₦12,000/week, "Pay ₦12,000 now" / "Pay it all off"); WISHES (3 wishes with sparkle values + swap icon); CERTIFICATES (UNILAG Short Courses); PERKS (locked, 40✨–150✨).
   - **Skills:** Cooking 10, Charisma 0, Fitness, Coding, Music, Hustle, Dance, Comedy, Photography; rust mechanic (unused 7 days → ~1 level/20 days, max 2).
   - **People:** "No friends yet — Visit places around town and say hello."
   - **Career:** track/rank (Tech · Rank 1 of 5 — Intern I, ₦8,600/shift, 9:00 AM–5:00 PM, Performance 50%, next rank preview, shifts done x/1, week row S M T W T F S, "You work today").
   - **Settings:** DISPLAY (Night mode Off/On/Auto; Camera turns by itself; Data & battery saver Auto/On/Off; Lite graphics Auto/On/Off; Sound effects/Music/Free will); NOTIFICATIONS (Messages & election news — showed "Blocked" disabled; Read receipts ✓✓; Show relationships); EMAIL (add email); SECURITY (Change password, Log out of all devices, Someone stole my account — Lock it); HELP (Help & guide, Replay the walkthrough, Contact support, Report a problem); DANGER (Log out, Main menu, New life); Terms/Privacy/Disclaimer; 18+ badge.
8. **Needs pill** → same dialog at Needs tab.
9. **Room rotate** → 90° camera rotation per tap.
10. **Keyboard icon** → shortcuts dialog: M map, H home, B buy mode (at home), P phone, S needs & skills, T things to do (venue), 1–9 venue spots, E people here (venue), arrows move furniture (buy), R rotate, Enter place/confirm, Del sell, C catalogue (buy), Esc close/cancel, ? this list.
11. **Next shift / Go to work** → job dialog: title/rank/pay (Intern I, Tech, ₦8,600/shift); next shift time; workplace ("CcHub · Yaba"); explainer ("Shifts run 6 AM–10 PM on work days. Clock in by 10:30 AM for an early-bird boost. Turn on auto-work and your Sim goes by itself."); getting-there options expand (Walk Free, Keke ₦150, Danfo ₦150, Okada ₦150, Cab ₦150); green "Go · ₦150" button; "Show CcHub on the map" link.

## C. Other screens observed

- **Buy mode** (bottom nav Buy): "Buy mode" pill top-left, wallet pill top-center, rotate/close top-right; bottom "Catalogue" sheet; category tabs (Design/Sleep/Kitchen/Bath/Comfort/Fun/Skills/Light); item cards show name, tile size, star rating, comfort icon, price. Sample prices: Plastic Chair ₦500 → Diamond Dream Bed ₦1,300,000; Cooler Box ₦700 → 5-Burner Cooker & Oven ₦420,000.
- **Map** (bottom nav Map): 3D stylized city (Mainland/Island/Lagoon, named bridges, player houses as green plots, advertising billboards "MEGA SCREEN ₦250k / 7 days"). Controls: "Traffic right now: Moving", tabs (Billboards/Neighbours/Sea plots/Government/Walk Yaba), city tabs (Lagos/Port Harcourt/Abuja), "Show place names" toggle, gov pill. 33 venues observed (Afrika Shrine … Jibowu Park, plus "OBO · Coming soon").
- **Venue dialog** (e.g. Amala Shitta, Surulere): description, share-link row, 12 activities (food items + social actions like "Gist with Mama"), "Player shops here", travel row (Trek Free/Keke ₦50/Danfo ₦50/Okada ₦200/Cab ₦350) + green "Go · ₦50".
- **Walk mode** ("Walk Yaba"): first-person night street walk; hint "Tap where you want to go. Hold and drag to steer."; Map button; Camera view/Snap; "Your gate · Go in", "Anywhere".
- **Phone** (bottom nav Phone): smartphone mockup (4G, time/date "Monday 12 October · Lagos", Night mode pill, Close). 40 apps observed one level deep: Jobs (auto-work checkbox, 30 listings with pay + skill gates, "Switch to this job"), Messages (Updates bell → notification feed: election news, mission completions, NEPA, salary, rent, skill-ups, voting prompts, gifts, loans; tabs Chats/Groups; "Message someone by username"), Games (old, wouldn't load), Meetumo (real tech events w/ ticket prices), PopOut Tickets + versiah.com (sponsored iframes), HANDI (partnership services + jobs), Eleventhco (sponsored perfume), Heala (telehealth), Games NEW (sponsored game app), Nollywood (sponsored), Bet Tips (sponsored), Contacts (Mummy contact, FIND A PLAYER search), Help & guide ("Ask Lagos Life" AI + 16 expandable guides), Courses (UNILAG Short Courses: 13 courses × 5 lessons, ₦1,000–₦4,000, certificate + career boost), Ride (destination list), Chowdeck (food delivery), Bank ("NAIJA RESERVE BANK": balance, net worth, top-up, savings vault, bonds, income tax, weekly bills, last receipt, money history), Boutique (3D avatar try-on, occasions, 10 items ₦15k–₦1.8m), Forbes ("LAGOS FORBES": 51,145 players ranked, Richest/Companies tabs, "YOUR RANK #36,356 of 51,145"), Houses (Homes/Invest/Rent tabs, listings from Face-me-I-face-you ₦2,400/wk to Banana Island mansion ₦1.5m/wk), Cars, Invite (house guest link), Health (chemist ₦1,500, hospital ₦8,000), Invest (land plots, haulage, 8 business types), Assurance (insurance: 6 cover types, weekly risk %, house condition), LagosBet (football/high-low/roulette, 18+), Family, Staff (hireable: house help ₦15k/wk, chef, driver, guard, nanny), Hustle (player job board w/ escrow), Bus Co. (start bus company), Company (wouldn't load), Shops (filters; listings didn't load), Lagos Gist (Twitter-style feed, 280 chars, Latest/Trending/Following/Me), Lagos Gov (governor/senator/president, votes, cabinet, policy, "Run for governor ₦50,000"), Give (wouldn't load), Police (record, report player, court link, robbery note), Court (lists didn't load), My Ads (billboard ₦250k/7 days, sea plot ₦500/7 days), Settings (mirrors character Settings).

## D. Onboarding / notifications / friends / money

- **Walkthrough** (Settings → Replay): modal "Welcome to Lagos! — Quick tour, under one minute." → 6 tooltips: 1) needs ("Keep them green: eat, sleep, baff"), 2) phone ("Jobs to earn. Messages to gist"), 3) map ("Tap any place, then travel there"), 4) money ("Work to earn it. Tap + to top up"), 5) houses ("Phone → Houses to move. Buy to furnish"), 6) help ("Phone → Help & guide, or ask anything"). Skip/Done exits.
- **Landing (pre-game):** crown logo, "Lagos Life — Live your Lagos story.", profile card (@user, date · net worth), Continue (green), New life, "Signed in as @user / Log out", social badges (X/TikTok/Instagram/LinkedIn).
- **Notifications:** Messages → "Updates" bell feed + popup dialogs (election security) + dismissible governor pill + bottom toasts. No separate notification center.
- **Friends:** People tab, Contacts FIND A PLAYER, Messages username box, Neighbours visits, Gist feed, Forbes "tap anyone to message", Family via player tap.
- **Money:** top-bar wallet + Bank app + LAPO loan. Balance unchanged through audit (nothing spent).

## E. Limitations

- Company, Give, Court lists, old Games app, Shops listings, Houses Invest/Rent tabs never loaded (slow network / saver mode).
- Port Harcourt map tab intermittently failed; Walk mode loads slowly.
- @Drblack0 stayed logged in; wallet untouched at ₦1,086,650.
