# CopyCat LUT

Copy the colour grade of a reference image onto your footage and export a `.cube` LUT for CapCut, Concat, Premiere or Resolve.

Open: https://jaegu504.github.io/copycat-lut/ (works on phones; add it to the home screen to use it offline).

- Camera log to Rec.709 conversion (Sony, Canon, Panasonic, Fujifilm, Nikon, ARRI, RED, Blackmagic, DJI, Apple Log, HLG).
- Tone and colour matching in Oklab: histogram-matched tone curve, per-zone colour shift, MKL colour spread, skin protection.
- Everything runs in the browser; no file leaves your device.

## How it was tested

Real Sony A7S III / FX3 S-Log3 footage (8 frames, different scenes) and 24 real colorist LOG LUTs.
A LUT grades shot A to make the reference; the ground truth is the same LUT on shot B; CopyCat only sees
shot B and the reference. Score: mean Oklab distance x100 to the ground truth (about 2 is barely visible).
Grade mode is tuned to look like the reference by eye: full saturation and hue transfer, hues mapped per
lightness zone (a look that turns bright greens yellow and dark greens teal keeps that split), tints from
mostly neutral pixels, and the midtones moved up to 0.2 toward the reference. Whites barely drop, so a
reference without bright objects does not turn white shirts grey.

On top, a palette warp pairs the footage's main colours with the reference's (4 for a broad look, 13 for detail) and moves each
footage colour toward its partner (smoothly in between, less when the pair is far apart, black and white
fixed). That copies looks with many colour families, such as teal metal, amber coat and cream highlights
in one frame, which three tints and six hue sectors cannot.

The cost: when a reference is darker only because of what is in it, the mid shift copies that darkness.
On the held-out colorist-LUT test below that scores worse than no grade; the "Kecerahan & kontras referensi" slider at 50% brings
it back (6.82).

| Reference shows | No grade (CST only) | Scene mode | Grade mode (default) |
| --- | --- | --- | --- |
| A different scene (held-out LUTs) | 7.55 | 17.48 | 9.52 (6.82 with that slider at 50%) |

Pick "Adegan sama" only when the reference is the same location and light; otherwise keep "Adegan lain".
The S-Log3 conversion lands within 2.7 of Sony's official S-Log3/S-Gamut3.Cine to Rec.709 LUT.
Saturated colours near the gamut edge are eased inward (ACES-style gamut compression), and highlights roll off per channel, like a camera LUT, so codec colour noise in near-white areas (shirts, sky)
stays as small as in Sony's LUT instead of turning into colour blotches.
