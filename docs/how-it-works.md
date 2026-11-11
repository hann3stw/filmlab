# How FilmLab talks to the camera

FilmLab never "develops" a RAW file itself. The camera's own image processor
does it — exactly like Fujifilm X RAW Studio. FilmLab only moves bytes over USB.

## The language: PTP over USB

The camera (Connection Mode **USB RAW CONV./BACKUP RESTORE**) speaks **PTP**
(Picture Transfer Protocol, ISO 15740). Every message is a *container*:

```
[length u32][type u16][code u16][transaction id u32][params or data …]
type: 1 = COMMAND, 2 = DATA, 3 = RESPONSE
```

One operation = COMMAND → (optional DATA, either direction) → RESPONSE (`0x2001` = OK).
Code: `src/camera/ptp/container.ts`, `transport.ts`.

## RAW conversion

| Step | PTP operation | What happens |
|---|---|---|
| 1 | `0x900C` SendObjectInfo (Fuji) | "A RAF file is coming" (format `0xF802`) |
| 2 | `0x900D` SendObject2 (Fuji) | the whole .RAF (25–55 MB) in 512 KB chunks |
| 3 | `0x1015` Get prop `0xD185` | camera returns a 625-byte **conversion profile** with the as-shot settings |
| 4 | `0x1016` Set prop `0xD185` | we send the profile back, with our changes patched in |
| 5 | `0x1016` Set prop `0xD183` = 0 | "start converting" |
| 6 | `0x1007` GetObjectHandles (poll) | until a result object appears |
| 7 | `0x1009` GetObject | download the full-resolution JPEG |
| 8 | `0x100B` DeleteObject | remove the temp JPEG from the camera |

The profile is an array of int32 fields at the end of the 625 bytes
(e.g. index 8 = film simulation, 16 = highlight ×10). FilmLab only overwrites
the fields you changed, so everything else stays "as shot".
For a re-render with new settings only steps 4–8 are needed (no re-upload).
Code: `src/camera/ptp/session.ts` (`loadRaf`, `reconvert`), `src/camera/profile/d185.ts`.

## Custom slots (C1…Cn)

Plain property reads/writes (`0x1015` / `0x1016`):

- `0xD18C` — **slot selector**: write N to "look at" slot CN (doesn't change its contents)
- `0xD18D` — slot name (PTP string)
- `0xD18E … 0xD1A5` — 24 settings (film sim `D192`, WB `D199`, highlight `D19D`, …)

Reading a slot = select it, then read D18D–D1A5. Writing (Phase 3) = select it,
write the name, write each setting in the order X RAW Studio uses, read back to verify.
`0x1014` GetDevicePropDesc tells us which values the camera allows
(e.g. how many slots exist, which film simulations it has).

Encodings differ between slots and the D185 profile (effects 1/2/3 vs 0/1/2,
grain as one enum, DR as 100/200/400, High-ISO NR uses its own table).
Code: `src/camera/profile/preset-translate.ts`.
