import * as THREE from 'three'

/**
 * "The Glow" (shared glow.ts): curtains of muted green light over the north of the county on a
 * rare clear night. Drawn on the sky dome (sky.ts) in coarse blocks of sky, its brightness cut
 * into a few hard steps with the 4×4 Bayer dither, so it reads as pixel art, never a smooth
 * gradient. night.ts fades it in with the dark, hides it behind cloud and fog, and lets it lay a
 * faint green over the ambient light (snow and lakes pick it up).
 */

/** Dev builds: `?glow=1` shows it every night (for looking at it). */
export const GLOW_PREVIEW =
  import.meta.env.DEV &&
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).has('glow')

/** The light it gives the world below (the bottom edge of the curtains). */
export const GLOW_LIGHT = new THREE.Color(0x4fae86)

/** The dome's uniforms for it. */
export interface GlowSkyUniforms {
  glowAlpha: { value: number }
  glowTime: { value: number }
}

export function glowSkyUniforms(): GlowSkyUniforms {
  return { glowAlpha: { value: 0 }, glowTime: { value: 0 } }
}

/**
 * The curtains over a sky colour (GLSL; needs skyHash from sky.ts). Two bands that hang from a
 * slowly wandering lower edge, brightest along it and thinning upwards from green into teal, cut
 * by vertical rays. Angles are snapped to cells first, so every bit of it is a block.
 */
export const SKY_GLOW_GLSL = /* glsl */ `
  uniform float glowAlpha;
  uniform float glowTime;
  const float GLOW_BAYER[16] = float[16](
    0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0
  );
  float glowBand(float az, float el, float base, float height, float seed) {
    float t = glowTime;
    float edge = base + 0.07 * sin(az * 2.3 + seed + t * 0.031) + 0.035 * sin(az * 5.7 - t * 0.047 + seed * 2.0);
    float above = el - edge;
    if (above < -0.02 || above > height) return 0.0;
    // A hard-ish lower hem, then a long fade upwards.
    float hem = clamp((above + 0.02) / 0.02, 0.0, 1.0);
    float rise = 1.0 - above / height;
    // Rays: some columns of sky brighter than others, drifting along.
    float col = floor(az * 34.0 + t * 0.08 + seed * 13.0);
    float ray = 0.45 + 0.55 * skyHash(vec3(col, seed, floor(t * 0.15 + seed)));
    return hem * rise * rise * ray;
  }
  vec3 glowSky(vec3 color, vec3 d) {
    if (glowAlpha <= 0.0 || d.y <= 0.02) return color;
    // North is -z. Snap the angles to coarse cells of sky.
    float az = atan(d.x, -d.z);
    float el = asin(clamp(d.y, 0.0, 1.0));
    const float CELL = 0.011;
    az = (floor(az / CELL) + 0.5) * CELL;
    el = (floor(el / CELL) + 0.5) * CELL;
    // Over the north mostly, gone behind you.
    float spread = clamp(1.0 - abs(az) / 1.9, 0.0, 1.0);
    if (spread <= 0.0) return color;
    float a = glowBand(az, el, 0.2, 0.42, 1.0);
    float b = glowBand(az + 0.6, el, 0.34, 0.3, 4.0) * 0.7;
    float lit = max(a, b) * spread * glowAlpha;
    // A few hard steps, dithered between them on the 4×4 grid.
    ivec2 p = ivec2(mod(gl_FragCoord.xy, 4.0));
    float threshold = (GLOW_BAYER[p.x + p.y * 4] + 0.5) / 16.0;
    float steps = floor(lit * 4.0 + threshold) / 4.0;
    if (steps <= 0.0) return color;
    // Green at the hem, teal and a little violet up high.
    float up = clamp((el - 0.2) / 0.5, 0.0, 1.0);
    vec3 tone = mix(vec3(0.07, 0.2, 0.11), vec3(0.05, 0.12, 0.15), up);
    tone = mix(tone, vec3(0.09, 0.06, 0.13), smoothstep(0.7, 1.0, up));
    return color + tone * steps;
  }
`
