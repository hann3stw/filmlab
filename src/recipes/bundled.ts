/**
 * Recipes that ship with FilmLab ("Popular recipes" on the home screen).
 * These are original FilmLab looks — a starting point to tweak.
 * They are read-only; "Save" copies one into your own collection.
 */

import { FilmSim, WBMode } from '../camera/profile/enums.ts'
import { DEFAULT_RECIPE, type Recipe } from './recipe.ts'

export interface BundledRecipe { key: string; name: string; note: { de: string; en: string }; recipe: Recipe }

const make = (r: Partial<Recipe>): Recipe => ({ ...DEFAULT_RECIPE, ...r })

export const BUNDLED: BundledRecipe[] = [
  {
    key: 'olive-grove', name: 'Olive Grove',
    note: { en: 'Warm, calm colors for sunny days.', de: 'Warme, ruhige Farben für sonnige Tage.' },
    recipe: make({
      filmSimulation: FilmSim.ClassicChrome, dynamicRange: 200, highlight: -1, shadow: 1, color: 2,
      whiteBalance: WBMode.Daylight, wbShiftR: 2, wbShiftB: -4, grain: 'weak', grainSize: 'small',
      colorChrome: 'strong', colorChromeBlue: 'weak', sharpness: -1, noiseReduction: -4,
    }),
  },
  {
    key: 'paper-lantern', name: 'Paper Lantern',
    note: { en: 'Punchy negative-film look with deep reds.', de: 'Kräftiger Negativfilm-Look mit satten Rottönen.' },
    recipe: make({
      filmSimulation: FilmSim.ClassicNeg, dynamicRange: 200, highlight: 1, shadow: 1.5, color: 3,
      whiteBalance: WBMode.Auto, wbShiftR: 3, wbShiftB: -5, grain: 'strong', grainSize: 'small',
      colorChrome: 'strong', colorChromeBlue: 'strong', sharpness: -2, noiseReduction: -4, clarity: -2,
    }),
  },
  {
    key: 'harbor-fog', name: 'Harbor Fog',
    note: { en: 'Soft, muted and slightly cool — for grey days.', de: 'Weich, gedämpft und leicht kühl – für graue Tage.' },
    recipe: make({
      filmSimulation: FilmSim.Eterna, highlight: -2, shadow: -1, color: -2,
      whiteBalance: WBMode.ColorTemp, wbColorTemp: 6300, wbShiftR: -2, wbShiftB: 3,
      grain: 'weak', grainSize: 'large', colorChromeBlue: 'weak', sharpness: -2, noiseReduction: -4, clarity: -3,
    }),
  },
  {
    key: 'kiosk-summer', name: 'Kiosk Summer',
    note: { en: 'Golden, nostalgic holiday prints.', de: 'Goldene, nostalgische Urlaubsabzüge.' },
    recipe: make({
      filmSimulation: FilmSim.NostalgicNeg, dynamicRange: 200, highlight: -1, shadow: 0.5, color: 2,
      whiteBalance: 0x8020, wbShiftR: 2, wbShiftB: -3, grain: 'weak', grainSize: 'small',
      colorChrome: 'weak', sharpness: -1, noiseReduction: -4,
    }),
  },
  {
    key: 'night-tram', name: 'Night Tram',
    note: { en: 'Cool city nights with glowing lights.', de: 'Kühle Stadtnächte mit leuchtenden Lichtern.' },
    recipe: make({
      filmSimulation: FilmSim.ClassicNeg, highlight: -1, shadow: 2, color: 1,
      whiteBalance: WBMode.ColorTemp, wbColorTemp: 4300, wbShiftR: -1, wbShiftB: 2,
      grain: 'strong', grainSize: 'large', colorChrome: 'strong', colorChromeBlue: 'strong',
      sharpness: -1, noiseReduction: -4, clarity: 2,
    }),
  },
  {
    key: 'graphite', name: 'Graphite',
    note: { en: 'Contrasty black & white with bold grain.', de: 'Kontrastreiches Schwarzweiß mit kräftigem Korn.' },
    recipe: make({
      filmSimulation: FilmSim.AcrosR, highlight: 2, shadow: 2, grain: 'strong', grainSize: 'large',
      sharpness: 1, noiseReduction: -4, clarity: 2,
    }),
  },
  {
    key: 'sunday-slide', name: 'Sunday Slide',
    note: { en: 'Vivid slide film for landscapes.', de: 'Lebendiger Diafilm für Landschaften.' },
    recipe: make({
      filmSimulation: FilmSim.Velvia, highlight: -1, shadow: -1, color: 1,
      whiteBalance: WBMode.Daylight, wbShiftR: 1, wbShiftB: -1, colorChromeBlue: 'strong', noiseReduction: -2,
    }),
  },
  {
    key: 'linen', name: 'Linen',
    note: { en: 'Gentle skin tones for portraits.', de: 'Sanfte Hauttöne für Porträts.' },
    recipe: make({
      filmSimulation: FilmSim.ProNegStd, highlight: -1, shadow: -1.5, color: 1,
      whiteBalance: WBMode.Auto, wbShiftR: 1, wbShiftB: -2, sharpness: -2, noiseReduction: -2, clarity: -2,
    }),
  },
]
