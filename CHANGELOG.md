# Changelog

## Start
- The original Zork I source (MIT, Microsoft 2025) compiles with ZILF and plays in the browser player.
- The smoke run reaches the cellar with 40 points in both the original and the remaster.

## Release 120
- Title banner: the opening now reads Remastered Edition, Release 120, credits Marc Blank, Dave Lebling, Bruce Daniels and Tim Anderson, and notes the live AI remaster (tests/banner.txt).
- Modern shortcuts: X now means EXAMINE; Z (WAIT) and G (AGAIN) already worked in Release 119 and are now covered by tests, with all original verbs unchanged (tests/shortcuts.txt).

## Room view
- The player draws the current room in 3D above the terminal. Remastered rooms are scenes in player/scenes; the rest of the world shows as a wireframe from the game's map.
- First scenes: West of House, Living Room, Cellar.
- North of House scene: the doorless north wall of the white house with its windows boarded up, and a narrow path winding north through the trees. The house prop gained a "door": false option for sides without a door.
