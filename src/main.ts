/**
 * FilmLab app entry point.
 *
 * Sets up: styles, error logging, the camera service, the screens (routes)
 * and the service worker (offline support + "install app").
 */
import './fonts.ts'
import './styles/base.css'
import './styles/app.css'

import { installGlobalErrorHandlers, log } from './ui/debug-log.ts'
import { addRoute, startShell } from './app/shell.ts'
import { cameraService } from './camera/camera-service.ts'
import { homeView } from './views/home.ts'
import { libraryView } from './views/library.ts'
import { recipesView } from './views/recipes.ts'
import { cameraView } from './views/camera.ts'
import { editorView } from './views/editor.ts'
import { registerServiceWorker } from './app/sw-register.ts'

installGlobalErrorHandlers()
log(`FilmLab ${__APP_VERSION__} starting · WebUSB ${'usb' in navigator ? 'yes' : 'NO'}`)

addRoute('home', homeView)
addRoute('library', libraryView)
addRoute('recipes', recipesView)
addRoute('camera', cameraView)
addRoute('edit', editorView, { tab: 'library', fullscreen: true })

startShell(document.getElementById('app')!)
void cameraService.init()
registerServiceWorker()
