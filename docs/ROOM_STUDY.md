# Room + Avatar Study — lagoslife.app (2026-10-10, behavioral notes only)

Observed via logged-in session on the owner's account. No code, assets, or
text copied — behavior and layout descriptions only. No purchases or changes
were made during the study.

## Avatar editor ("Sim panel")
- Opened from the home room via avatar portrait → centered dialog with tabs:
  Profile, Needs, Goals, Skills, People, Career, Settings.
- Profile tab: display name, mood/title line, masked email + Change link,
  "Invite people to your house" card with house invite link + share button,
  display-name field, Change username link.
- 3D avatar preview labeled "Drag to spin" — pointer drag rotates character.
- Sections: Body (Woman/Man toggle pills); Hairstyle (7 pills: Low cut, Bald,
  Curls, Afro, Locs, Braids, Classic); Outfit (5: Casual, Hoodie, Office,
  Chill, Site work); Fabric (4: Plain, Ankara, Adire, Aso-oke); Skin tone
  (~14 swatches); Outfit colour (~10 swatches); Bottoms (~10 swatches).
- Staged save: button reads "No changes yet" (disabled) until user changes
  something, then becomes enabled "Save profile". Reverting restores disabled
  state. (Verified by toggling a hairstyle.)

## Buy mode (room editing)
- Bottom nav: Home / Buy / Map / Phone. Tapping Buy slides a left "Catalogue"
  panel over the 3D room. Panel top: "Turn the room", "Exit buy mode", "Hide".
- Categories: Design, Sleep, Kitchen, Bath, Comfort, Fun, Skills, Light,
  Decor, Pets, Luxury.
- Item cards: name, size ("1x1", "2x2", "wall"), star rating, color-count
  indicator, naira price, playful one-line description. Unaffordable items
  disabled with "Need N… more" note.
- Design tab (walls/floors): "Paint it your way" + "Pick your floor" swatch
  cards with name + price. Tapping previews free on the room with banner
  "Trying on [name] — Nothing's paid yet" + Cancel / "Buy N…" buttons.
  Cancel reverts. (Verified.)
- Placement: tapping an item enters placement mode — ghost on green tile,
  banner shows name/price + "Drag or arrow keys move — R rotates — Enter
  places — Esc cancels". On-screen d-pad: 4 diagonal move buttons, Rotate,
  green Place, Cancel. (Entered placement, rotated, cancelled — no purchase.)

## Tapping room objects (live mode)
- Bed → "Spring Bed" dialog: "Pick an action" rows with emoji, duration
  ("36s", "15s"), "Free", action name (Sleep / Take a Nap / Stay in Bed),
  stat benefit (+Energy, +Energy +Fun).
- Cooler → "Cooler Box" dialog: Eat section (food items with +Hunger), "Your
  pantry" list, "Order groceries", "Cook on Kerosene Stove" buttons,
  "Guests can use my kitchen" toggle. Escape dismisses.

## Takeaways for our rebuild (original implementation)
- Staged avatar editing with dirty-state save button is good UX — adopt.
- Try-before-buy for walls/floors with explicit free preview — adopt.
- Placement via d-pad + rotate + explicit Place/Cancel is clear — adopt, and
  add tap-tile-to-move (faster on touch).
- Object action dialogs should show effect labels, not just action names.
- Keep our server-authoritative economy; our actions stay instant (no fake
  durations).
