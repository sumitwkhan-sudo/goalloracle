/**
 * Bread-to-Toaster — player skins + kitchen themes.
 *
 * Pure data (colours only) so the picker UI and the canvas renderer share
 * one source of truth. Skins recolour the bread character; themes recolour
 * the kitchen wall + window. The counter/shelves stay wood-toned so every
 * combination still reads as a kitchen.
 */

export const TOAST_SKINS = [
  { id: 'classic', name: 'Classic', crust: '#e3a857', inside: '#fbe6c2', foot: '#c98a3c' },
  { id: 'wheat', name: 'Wheat', crust: '#a9743e', inside: '#e8cfa0', foot: '#8a5e30', seeds: true },
  { id: 'sourdough', name: 'Sourdough', crust: '#d99a4a', inside: '#f5e8c8', foot: '#bd853a' },
  { id: 'rye', name: 'Rye', crust: '#6e4a2a', inside: '#caa878', foot: '#553718' },
];

export const KITCHEN_THEMES = [
  { id: 'cream', name: 'Cream', wallTop: '#fdf3e3', wallBottom: '#f6e2c4', sky: '#bfe6ff', frame: '#d9b27a', cloud: '#ffffff' },
  { id: 'blue', name: 'Blue', wallTop: '#eaf3fb', wallBottom: '#cfe3f4', sky: '#8fd0ff', frame: '#7ea7c8', cloud: '#ffffff' },
  { id: 'mint', name: 'Mint', wallTop: '#eafaf1', wallBottom: '#cdeede', sky: '#b6ecd6', frame: '#7cc4a3', cloud: '#ffffff' },
  { id: 'sunset', name: 'Sunset', wallTop: '#fff0e6', wallBottom: '#ffd9c2', sky: '#ffb27a', frame: '#e08a5a', cloud: '#fff4e8' },
];

export const DEFAULT_SKIN = TOAST_SKINS[0];
export const DEFAULT_THEME = KITCHEN_THEMES[0];

export function skinById(id) { return TOAST_SKINS.find((s) => s.id === id) || DEFAULT_SKIN; }
export function themeById(id) { return KITCHEN_THEMES.find((t) => t.id === id) || DEFAULT_THEME; }
