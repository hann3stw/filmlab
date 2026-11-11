/**
 * Entry point of diagnostics.html — the Phase 0 connection check page,
 * kept as a separate page for testing new cameras / firmware.
 * (Separate page = its own USB connection, it can't disturb the app.)
 */
import './fonts.ts'
import './styles/base.css'
import './phase0/check-page.css'

import { mountCheckPage } from './phase0/check-page.ts'
import { installGlobalErrorHandlers } from './ui/debug-log.ts'

installGlobalErrorHandlers()
mountCheckPage(document.getElementById('app')!)
