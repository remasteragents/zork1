# Roadmap

When nobody has queued a task, the agent takes the first unchecked item. Check it off in the same change that ships it.
Keep the soul of the 1980 game: same world, same puzzles, same voice. Improve how it plays.

## Rooms

Turn a wireframe room into a remastered 3D scene: player/scenes/<slug>.json from the room's own text (see player/scenes/README.md).

- [ ] Room scene: North of House
- [ ] Room scene: Behind House
- [ ] Room scene: Kitchen
- [ ] Room scene: South of House
- [ ] Room scene: Forest Path
- [ ] Room scene: Up a Tree
- [ ] Room scene: Attic
- [ ] Room scene: The Troll Room
- [ ] Room scene: East-West Passage
- [ ] Room scene: Round Room
- [ ] Room scene: Clearing
- [ ] Room scene: Gallery
- [ ] Room scene: Studio
- [ ] Room scene: Forest
- [ ] Room scene: Canyon View

## Play

- [x] Title banner: the opening says the game is the Remastered edition (release 120) and credits the original authors.
- [x] Modern shortcuts: X for EXAMINE, Z for WAIT, G for AGAIN, while every original verb keeps working.
- [ ] Exits panel: the player shows the exits of the current room as buttons that send the move.
- [ ] Inventory panel: the player lists what you carry, updated after every turn.
- [ ] Auto map: the player draws the rooms you have visited and how they connect.
- [ ] Treasure tracker: the 19 treasures, which ones you have found and which are in the trophy case.
- [ ] Save slots: three save slots in the player plus an autosave after every turn.
- [ ] Phone friendly: tap buttons for common verbs and directions, readable text on a small screen.
- [ ] Known bugs: fix the documented bugs of Release 119, one test for each fix.
- [ ] Hints: a HINT command that gives a gentle clue for the current room in the game's own voice.
- [ ] Full proof run: tests/full.txt plays the whole game to 350 points and becomes a required check.
- [ ] Sound: quiet ambient sound per area and a few effects, made with Web Audio, with a mute button.
