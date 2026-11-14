// Pixel-art post pass: tone map → sRGB → outlines → ordered dither + color quantization.
#include <packing>

uniform sampler2D tColor;
uniform sampler2D tOverlay; // viewmodel, premultiplied over transparent black
uniform sampler2D tBloom;   // blurred bright parts (half resolution)
uniform float bloomStrength;
uniform sampler2D tDepth;
uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform float exposure;
uniform int colorMode;      // 0 = off, 1 = per-channel levels, 2 = palette
uniform float levels;
uniform float dither;
uniform float outlines;
uniform float contrast;     // 0 = flat, 1 = deep blacks and hot highlights
uniform float saturation;   // 1 = as lit
uniform float vignette;     // 0 = none, 1 = dark corners
uniform vec3 palette[64];   // sRGB
uniform int paletteSize;
// Survival: the bite taking hold (game/infection.ts). 0 = clean … 1 = turning.
uniform float infection;
uniform float infectPulse;  // 0–1, peaks on each heartbeat
uniform float infectTime;   // seconds, for the sway
uniform float infectMotion; // 0 = hold still (reduced motion), 1 = sway and drift

varying vec2 vUv;

const float BAYER4[16] = float[16](
   0.0,  8.0,  2.0, 10.0,
  12.0,  4.0, 14.0,  6.0,
   3.0, 11.0,  1.0,  9.0,
  15.0,  7.0, 13.0,  5.0
);

float bayer(vec2 fragCoord) {
  ivec2 p = ivec2(mod(fragCoord, 4.0));
  return (BAYER4[p.x + p.y * 4] + 0.5) / 16.0 - 0.5; // -0.5 .. 0.5
}

// Narkowicz ACES fit: cheap filmic curve, keeps highlights from clipping flat.
vec3 acesFilm(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float viewDepth(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
}

vec3 nearestPaletteColor(vec3 c) {
  vec3 best = palette[0];
  float bestDist = 1e9;
  for (int i = 0; i < 64; i++) {
    if (i >= paletteSize) break;
    vec3 d = c - palette[i];
    // Luma-weighted distance: closer to perceived difference than plain RGB.
    float dist = dot(d * d, vec3(0.299, 0.587, 0.114));
    if (dist < bestDist) {
      bestDist = dist;
      best = palette[i];
    }
  }
  return best;
}

// The world, gun and glow at one point (linear, before tone mapping).
vec3 sceneAt(vec2 uv) {
  vec4 o = texture2D(tOverlay, uv);
  return texture2D(tColor, uv).rgb * (1.0 - o.a) + o.rgb + texture2D(tBloom, uv).rgb * bloomStrength;
}

// Late in the turn: the picture sways, softens and doubles (a ghost drifting to one side).
vec3 infectedScene() {
  float late = smoothstep(0.45, 1.0, infection);
  float t = infectTime;
  vec2 sway = infectMotion * late * 0.006 *
    vec2(sin(t * 0.9) + 0.5 * sin(t * 2.3), cos(t * 0.7) + 0.4 * sin(t * 1.7));
  vec2 uv = vUv + sway;
  vec3 c = sceneAt(uv);
  if (late <= 0.0) return c;
  vec2 texel = 1.0 / resolution;
  vec2 r = texel * (0.8 + 2.2 * late);
  vec3 soft = (sceneAt(uv + vec2(r.x, r.y)) + sceneAt(uv - vec2(r.x, r.y)) +
               sceneAt(uv + vec2(r.x, -r.y)) + sceneAt(uv - vec2(r.x, -r.y))) * 0.25;
  c = mix(c, soft, 0.35 + 0.4 * late);
  float drift = mix(0.7, 0.6 + 0.4 * sin(t * 0.5), infectMotion);
  vec2 ghost = vec2(0.006 + 0.004 * infectPulse, 0.0015) * late * drift;
  return mix(c, sceneAt(uv + ghost), 0.3 * late);
}

void main() {
  vec4 overlay = texture2D(tOverlay, vUv);
  vec3 color = infection > 0.0 ? infectedScene() : sceneAt(vUv);
  color = linearToSRGB(acesFilm(color * exposure));

  // Grade: richer colours, then an S-curve that sinks the shadows and lifts the lights.
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = max(vec3(0.0), mix(vec3(luma), color, saturation));
  vec3 curved = color * color * (3.0 - 2.0 * color);
  // Shadows follow the curve all the way (and a bit past it); highlights only part of it.
  vec3 deep = mix(curved, curved * color, 0.35);
  color = mix(color, mix(deep, curved, smoothstep(0.25, 0.75, color)), contrast);
  vec2 fromCentre = vUv - 0.5;
  color *= 1.0 - vignette * smoothstep(0.25, 0.95, dot(fromCentre, fromCentre) * 2.0);

  // The bite: colour drains out, the edges throb red with the heart, the last minute goes red.
  if (infection > 0.0) {
    float grey = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(color, vec3(grey), smoothstep(0.0, 0.45, infection) * 0.8);
    float edge = smoothstep(0.1, 0.85, dot(fromCentre, fromCentre) * 2.0);
    float throb = edge * min(1.0, infection * 2.5) * (0.5 + 0.5 * infectPulse);
    color = mix(color, vec3(0.38, 0.0, 0.02), throb * 0.8);
    float last = smoothstep(0.8, 1.0, infection) * (0.8 + 0.2 * infectPulse);
    color = mix(color, color * vec3(1.3, 0.4, 0.35) + vec3(0.07, 0.0, 0.0), last * 0.75);
  }

  // 1 px outline where this pixel sits in front of a much farther neighbour (silhouette edges).
  if (outlines > 0.0 && overlay.a < 0.5) {
    vec2 texel = 1.0 / resolution;
    float d = viewDepth(vUv);
    float far = max(
      max(viewDepth(vUv + vec2(texel.x, 0.0)), viewDepth(vUv - vec2(texel.x, 0.0))),
      max(viewDepth(vUv + vec2(0.0, texel.y)), viewDepth(vUv - vec2(0.0, texel.y)))
    );
    float edge = step(0.12 * d + 0.15, far - d);
    color *= 1.0 - edge * outlines;
  }

  float threshold = bayer(gl_FragCoord.xy) * dither;
  if (colorMode == 1) {
    float steps = levels - 1.0;
    color = floor(color * steps + 0.5 + threshold) / steps;
  } else if (colorMode == 2) {
    color = nearestPaletteColor(color + threshold * 0.12);
  }

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
