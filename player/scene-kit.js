// scene-kit.js: the vocabulary of room scenes. Shared by the renderer (scene.js) and the scene check (tests/scenes.mjs).
// A new material, prop or exit type is added here first, then drawn in scene.js.

export const MATERIALS = ['stone', 'brick', 'flagstone', 'rock', 'planks', 'wood', 'siding', 'plaster', 'grass', 'dirt', 'sand', 'leaves', 'bark', 'metal', 'water', 'marble', 'carpet', 'darkness'];

export const PROPS = [
  'torch', 'crate', 'chest', 'barrel', 'table', 'chair', 'rug', 'trophy-case', 'lantern', 'sword', 'mailbox', 'tree', 'bush',
  'boulder', 'house', 'window', 'pillar', 'stalagmite', 'altar', 'coffin', 'skeleton', 'sign', 'fireplace', 'painting', 'bars',
  'rope', 'puddle', 'bones', 'pile', 'nest', 'sack', 'bottle', 'boards', 'stairs',
];

export const EXITS = ['passage', 'door', 'arch', 'crawl', 'stairs', 'trapdoor', 'window', 'ramp', 'chimney', 'hole', 'path', 'none'];

export const WALLS = ['north', 'east', 'south', 'west'];
