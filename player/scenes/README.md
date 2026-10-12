# Room scenes

Every room of Zork I can have a 3D scene: `player/scenes/<slug>.json`, where the slug is the room name in
lower case with dashes (`West of House` → `west-of-house.json`). Rooms that share a name share a scene (the maze).
A room without a file is drawn as a lime wireframe straight from the game's map, marked NOT REMASTERED YET.

Build each scene from the room's own text in `src/1dungeon.zil` (LDESC and the objects in the room). Show what the
text says, nothing it does not say. The renderer and its kit are `player/scene.js` and `player/scene-kit.js`;
add a new prop or material there when a room needs one.

```json
{
  "room": "Cellar",                 // exact room name, as the game prints it
  "kind": "indoor",                 // indoor | outdoor
  "size": [7, 3.2, 9],              // width (east-west), height, depth (north-south) in meters
  "walls": "stone", "floor": "flagstone", "ceiling": "rock",
  "ambient": 0.08,                  // 0 dark .. 1 bright
  "lantern": true,                  // the player's lamp lights the room (dark places)
  "camera": [0, 1.6, 4], "look": [0, 1.3, -4],   // optional: where the viewer stands and looks
  "exits": {                        // optional: how each exit looks; exits of the game without an entry get a default
    "north": { "type": "passage", "label": "a narrow passageway" },
    "west":  { "type": "ramp", "label": "a steep metal ramp", "cmd": "west" },
    "up":    { "type": "trapdoor" }
  },
  "props": [
    { "type": "torch", "wall": "east", "at": [1.5, 2.0] },          // on a wall: [offset along the wall, height]
    { "type": "crate", "at": [2, 0, 1.5], "rot": 30,                // on the floor: [x, y, z], x east, z south
      "label": "a wooden crate", "cmd": "examine crate" }           // label and cmd make it clickable
  ]
}
```

Outdoor scenes stand on a large ground plane; add `"sky"` (a colour) and `"path": {"width", "length", "angle", "x", "z"}`.
Exits outdoors are lime markers at the edge of the clearing.

Kit (see `player/scene-kit.js` for the full lists):
- materials: stone, brick, flagstone, rock, planks, wood, siding, plaster, grass, dirt, sand, leaves, bark, metal, water, marble, carpet, darkness
- exit types: passage, door, arch, crawl, stairs, trapdoor, window, ramp, chimney, hole, path, none
- props: torch, crate, chest, barrel, table, chair, rug, trophy-case, lantern, sword, mailbox, tree, bush, boulder, house,
  window, pillar, stalagmite, altar, coffin, skeleton, sign, fireplace, painting, bars, rope, puddle, bones, pile, nest,
  sack, bottle, boards, stairs

`node tests/scenes.mjs` checks every scene against the kit and the game's room list. It runs on every build.
