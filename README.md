# The Simulation

A Dwarf Fortress–inspired living-world simulation that runs in the browser.

**Play it online: https://mandrille.github.io/living-world/**

There is **one world**, the same for everyone who opens the page — computed deterministically from the current age's seed and anchored to real time (no server). The world takes one step every 20 real seconds. Each **age lasts seven real days**; at its end **the Judgment** crowns a winner by population, stores, and knowledge, and a new age dawns. Click anything on the map — a person, a 300-year-old yew, a half-built barracks — and it will tell you about itself.

- **Symbolic art**: the world is drawn as colored glyphs on a canvas (`@` agents, `♠` forests, `▲` mountains, `◆◇⌂▦✠⚒` buildings, `w` wolves, `☠` the dead, `∙` roads worn in by foot traffic).
- **Hundreds of agents**: 270 founders grow into a thousand souls. Click anyone — living or dead — for a record-sheet-style character sheet: nine attributes (Physical / Social / Mental, rated in dots 1–5), skill columns with dot ratings, Health/Hunger/Renown tracks, gear with real makers and provenance, personality, beliefs, family, and a life history of everything they've done. Body parts are itemized only when wounded, scarred, or missing; sections collapse and remember their state.
- **Family trees**: couples marry and raise children who inherit their parents' attributes and looks, come of age, and mourn their dead. Kill someone's spouse and their kin swear blood-oaths — and battlefield targeting honors the grudge.
- **Factions, lore & politics**: procedurally generated peoples with founding myths, ethea, governments, titled leaders and succession. Gifts, insults, marriages and border disputes shift relations; wars get chronicled names ("the War of the Broken Oath"), bloody seasons become named battles, and crushing victories annex hamlets.
- **Economy**: food/wood/stone/metal gathering, farms, houses, barracks, workshops where named smiths forge gear (masterworks become artifacts like "Ashbiter"), trade caravans between friendly powers, and hamlet expansion when settlements outgrow their halls.
- **A dangerous world**: wolf packs stalk lone travelers; contagious diseases gnaw at organs while medics make their rounds (and cut out tumors); wildfires, earthquakes, and floods reshape the land.
- **Research**: factions pursue warcraft (bronze → gunpowder → atomics — desperate wars can end in a nuclear sunfire that craters the map), commerce (coinage → the Grand Exchange), or science (letters → rocketry → spaceflight).
- **Mutations**: born strange, changed by sickness, seared by the sunfire, or poisoned by glowing craters — third eyes that grant resolve, ember blood that mends flesh, contagious weeping tumors, glass bones. Effects ride the uncapped numeric attributes.
- **Mobile-friendly**: responsive layout, touch pan / tap select / pinch zoom.

## Run

```
npm install
npm run dev
```

Open http://localhost:5199 — append `?seed=12345` for a reproducible world.

## Controls

- **Drag** to pan, **scroll** to zoom (or −/+ buttons); **minimap** (bottom right) click to jump
- Click an agent, corpse, or building to inspect it; hover for tooltips
- Tabs: Inspect / Factions (lore, notables, population sparklines) / Legends (famous figures & named artifacts) / Chronicle (filterable world history)
- Top bar: pause / 1× / 3× / 10× speed, ⟳ New World, 💾 Save / 📂 Load (localStorage)

## Structure

| file | what it does |
| --- | --- |
| `src/sim.ts` | the engine: agent AI, body-part combat & morale, economy, buildings, births/aging, politics, wars, plagues, wolves, trade, persistence |
| `src/agents.ts`, `src/body.ts`, `src/items.ts` | character generation: body plans, inheritance, gear, forging |
| `src/factions.ts`, `src/names.ts` | faction, settlement, war & lore generation |
| `src/world.ts` | terrain generation |
| `src/render.ts` | glyph renderer: camera (zoom/pan), cached terrain, minimap, hover labels, dirty-flag redraws |
| `src/ui.ts` | character sheets, faction pages, legends, chronicle |
| `src/rng.ts` | seeded RNG (mulberry32) for reproducible worlds |
