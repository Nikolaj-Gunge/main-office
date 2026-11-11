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
uniform vec3 palette[64];   // sRGB
uniform int paletteSize;

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

void main() {
  vec4 overlay = texture2D(tOverlay, vUv);
  vec3 color = texture2D(tColor, vUv).rgb * (1.0 - overlay.a) + overlay.rgb;
  color += texture2D(tBloom, vUv).rgb * bloomStrength;
  color = linearToSRGB(acesFilm(color * exposure));

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
