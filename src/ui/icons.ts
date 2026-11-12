/**
 * Line icons as inline SVG strings (24×24, stroke = currentColor, so they take
 * the text color). Drawn for FilmLab — no icon font needed, works offline.
 */

const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

export const icons = {
  home: svg('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>'),
  library: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>'),
  recipes: svg('<path d="M6 3.5h9l3 3v14H6z"/><path d="M15 3.5v3h3"/><path d="M9 11h6M9 14.5h6M9 18h4"/>'),
  camera: svg('<path d="M3.5 8.5h3l1.5-2.5h8l1.5 2.5h3v11h-17z"/><circle cx="12" cy="13.5" r="3.6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  undo: svg('<path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-2"/>'),
  share: svg('<path d="M12 15V3.5"/><path d="M7.5 8 12 3.5 16.5 8"/><path d="M5 12v8.5h14V12"/>'),
  download: svg('<path d="M12 3.5V15"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/>'),
  expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  compare: svg('<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M12 3v18"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  usb: svg('<path d="M12 3v14"/><path d="M9.5 5.5 12 3l2.5 2.5"/><path d="M12 13l-4-2V8.5"/><path d="M12 15l4-2v-2.5"/><circle cx="12" cy="19" r="2"/><rect x="6.8" y="7" width="2.4" height="2" /><circle cx="16" cy="9.5" r="1.1"/>'),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.4"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  check: svg('<path d="M5 12.5 10 17.5 19 7"/>'),
  heart: svg('<path d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10z"/>'),
  heartFilled: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10z"/></svg>',
  filter: svg('<path d="M4 6.5h16M7 12h10M10 17.5h4"/>'),
  album: svg('<rect x="4" y="6.5" width="16" height="13" rx="1.5"/><path d="M7 4h10"/><path d="m7 16 3.5-4 3 3 2-2 2.5 3"/>'),
  wand: svg('<path d="m4 20 11-11"/><path d="m13 7 2-2 2 2-2 2z"/><path d="M18 3v2M20 6h-2M19 10v1.5M8 4v1.5"/>'),
  more: svg('<circle cx="6" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18" cy="12" r="1"/>'),
  crop: svg('<path d="M7 3v14h14"/><path d="M3 7h14v14"/>'),
  trash: svg('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>'),
}
