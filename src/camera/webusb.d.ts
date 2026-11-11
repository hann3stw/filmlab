// ---------------------------------------------------------------------------
// Ported from FilmKit (https://github.com/eggricesoy/filmkit)
// Copyright (c) 2026 eggricesoy — MIT License, see /LICENSE-FilmKit.
// Adapted for FilmLab (changes are marked with "FilmLab:" comments).
// ---------------------------------------------------------------------------

// WebUSB API type declarations
// These aren't in TypeScript's standard DOM lib yet

interface USBDeviceFilter {
  vendorId?: number
  productId?: number
  classCode?: number
  subclassCode?: number
  protocolCode?: number
  serialNumber?: string
}

interface USBDeviceRequestOptions {
  filters: USBDeviceFilter[]
}

interface USBEndpoint {
  endpointNumber: number
  direction: 'in' | 'out'
  type: 'bulk' | 'interrupt' | 'isochronous'
  packetSize: number
}

interface USBAlternateInterface {
  alternateSetting: number
  interfaceClass: number
  interfaceSubclass: number
  interfaceProtocol: number
  interfaceName: string | undefined
  endpoints: USBEndpoint[]
}

interface USBInterface {
  interfaceNumber: number
  alternate: USBAlternateInterface
  alternates: USBAlternateInterface[]
  claimed: boolean
}

interface USBConfiguration {
  configurationValue: number
  configurationName: string | undefined
  interfaces: USBInterface[]
}

interface USBInTransferResult {
  data: DataView | undefined
  status: 'ok' | 'stall' | 'babble'
}

interface USBOutTransferResult {
  bytesWritten: number
  status: 'ok' | 'stall'
}

interface USBDevice {
  vendorId: number
  productId: number
  deviceClass: number
  deviceSubclass: number
  deviceProtocol: number
  deviceVersionMajor: number
  deviceVersionMinor: number
  deviceVersionSubminor: number
  manufacturerName: string | undefined
  productName: string | undefined
  serialNumber: string | undefined
  configuration: USBConfiguration | null
  configurations: USBConfiguration[]
  opened: boolean

  open(): Promise<void>
  close(): Promise<void>
  forget(): Promise<void>
  selectConfiguration(configurationValue: number): Promise<void>
  claimInterface(interfaceNumber: number): Promise<void>
  releaseInterface(interfaceNumber: number): Promise<void>
  selectAlternateInterface(interfaceNumber: number, alternateSetting: number): Promise<void>
  transferIn(endpointNumber: number, length: number): Promise<USBInTransferResult>
  transferOut(endpointNumber: number, data: BufferSource): Promise<USBOutTransferResult>
  clearHalt(direction: 'in' | 'out', endpointNumber: number): Promise<void>
  reset(): Promise<void>
}

interface USB {
  getDevices(): Promise<USBDevice[]>
  requestDevice(options: USBDeviceRequestOptions): Promise<USBDevice>
  addEventListener(type: 'connect' | 'disconnect', listener: (event: USBConnectionEvent) => void): void
  removeEventListener(type: 'connect' | 'disconnect', listener: (event: USBConnectionEvent) => void): void
}

interface USBConnectionEvent extends Event {
  device: USBDevice
}

interface Navigator {
  usb: USB
}
