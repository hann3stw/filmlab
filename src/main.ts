/**
 * FilmLab entry point.
 *
 * Phase 0: shows only the connection check page. In Phase 1 this file will
 * set up the real app (bottom navigation, screens, service worker) and the
 * check page will live on as a "Diagnostics" screen.
 */

// Fonts are bundled with the app (not loaded from Google), so they work offline.
import '@fontsource/fraunces/400.css'
import '@fontsource/fraunces/500.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'

import './styles/base.css'
import './phase0/check-page.css'

import { mountCheckPage } from './phase0/check-page.ts'
import { installGlobalErrorHandlers } from './ui/debug-log.ts'

installGlobalErrorHandlers()
mountCheckPage(document.getElementById('app')!)
