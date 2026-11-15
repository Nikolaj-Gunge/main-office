// Mist: a short ray march from the eye to whatever this pixel hit, at a coarse resolution.
// Out: rgb = light the mist scatters towards you, a = how much of the scene still shows through.
// STEPS and SHAFTS come in as defines (fog-atmosphere.ts's tiers).

uniform sampler2D tDepth;
uniform sampler2DShadow tShadow;
uniform mat4 shadowMatrix;
uniform float shafts;        // 0: no shadow map (yet)
uniform mat4 projInv;
uniform mat4 camWorld;
uniform vec3 camPos;
uniform float density;
uniform float mistBase;
uniform float mistHeight;
uniform float far;
uniform float time;
uniform vec3 mistColor;
uniform vec3 lakeGlow;       // extra light in the mist over water (it reads even on a black night)
uniform vec4 lakes[2];       // x, z, radius (0: none), water height
uniform vec3 moonDir;        // towards the moon
uniform vec3 moonLight;
uniform vec3 torchPos;
uniform vec3 torchDir;
uniform float torchCos;
uniform vec3 torchLight;     // 0: off
uniform int lampCount;
uniform vec4 lampPos[9];     // xyz, range
uniform vec3 lampLight[9];

varying vec2 vUv;

const float BAYER4[16] = float[16](
   0.0,  8.0,  2.0, 10.0,
  12.0,  4.0, 14.0,  6.0,
   3.0, 11.0,  1.0,  9.0,
  15.0,  7.0, 13.0,  5.0
);

float bayer(vec2 fragCoord) {
  ivec2 p = ivec2(mod(fragCoord, 4.0));
  return (BAYER4[p.x + p.y * 4] + 0.5) / 16.0;
}

// Halos come in this many hard steps (dithered at their edges): pixel art, not a soft glow.
const float BANDS = 5.0;

float lakeMist = 0.0;        // mistAt's share over water, for the last point asked about

float mistAt(vec3 p) {
  // Thick below the mist line (hollows), thinning above it.
  float h = min(3.0, exp(-(p.y - mistBase) / mistHeight));
  float lake = 0.0;
  for (int i = 0; i < 2; i++) {
    vec4 l = lakes[i];
    if (l.z <= 0.0) continue;
    float d = length(p.xz - l.xy);
    lake += (1.0 - smoothstep(l.z * 0.7, l.z + 45.0, d)) * exp(-max(p.y - l.w, 0.0) / 4.0) * 5.0;
  }
  // Slow banks drifting through.
  float drift = 0.7 + 0.3 * sin(p.x * 0.045 + time * 0.08) * sin(p.z * 0.039 - time * 0.06);
  lakeMist = lake / (h + lake + 1e-4);
  return density * (h + lake) * drift;
}

#ifdef SHAFTS
float moonVisible(vec3 p) {
  vec4 s = shadowMatrix * vec4(p, 1.0);
  vec3 c = s.xyz / s.w;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  return texture(tShadow, vec3(c.xy, c.z - 0.002));
}
#endif

float torchAt(vec3 p) {
  vec3 v = p - torchPos;
  float d = length(v);
  float cone = smoothstep(torchCos, mix(torchCos, 1.0, 0.5), dot(v, torchDir) / max(d, 1e-3));
  return cone / (1.0 + d * d * 0.05) * (1.0 - smoothstep(30.0, 48.0, d));
}

void main() {
  float b = bayer(gl_FragCoord.xy);
  float depth = texture2D(tDepth, vUv).x;
  vec4 view = projInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 world = (camWorld * vec4(view.xyz / view.w, 1.0)).xyz;
  vec3 ray = world - camPos;
  float dist = length(ray);
  vec3 rd = ray / max(dist, 1e-4);
  float len = depth >= 1.0 ? far : min(dist, far);

  // Phase: the mist glows most looking towards the moon (Henyey-Greenstein, isotropic = 1).
  const float G = 0.55;
  float cosT = dot(rd, moonDir);
  float phase = (1.0 - G * G) / pow(1.0 + G * G - 2.0 * G * cosT, 1.5);

  float T = 1.0;
  vec3 light = vec3(0.0);
  bool torchOn = dot(torchLight, torchLight) > 0.0;
  // Samples bunch up near the eye (t grows with the square), jittered by the Bayer pattern.
  for (int i = 0; i < STEPS; i++) {
    float a0 = float(i) / float(STEPS);
    float a1 = float(i + 1) / float(STEPS);
    float t0 = len * a0 * a0;
    float t1 = len * a1 * a1;
    float t = mix(t0, t1, b);
    vec3 p = camPos + rd * t;
    float sigma = mistAt(p);
    if (sigma <= 0.0) continue;
    vec3 lit = mistColor + lakeGlow * lakeMist;
#ifdef SHAFTS
    lit += moonLight * phase * moonVisible(p) * shafts;
#endif
    if (torchOn) lit += torchLight * torchAt(p);
    float absorbed = 1.0 - exp(-sigma * (t1 - t0));
    light += T * absorbed * lit;
    T *= 1.0 - absorbed;
  }

  // Lamp halos: light scattered off the ray by each lamp, worked out exactly (the integral of
  // 1/r² along the ray), then cut into hard bands.
  for (int i = 0; i < 9; i++) {
    if (i >= lampCount) break;
    vec3 lp = lampPos[i].xyz;
    float tc = dot(lp - camPos, rd);
    float h = max(0.25, length(camPos + rd * tc - lp));
    float stop = depth >= 1.0 ? len : dist;
    // How much of the lamp the ray passes (0 when it is behind what this pixel shows) ...
    float seen = (atan((stop - tc) / h) - atan(-tc / h)) / 3.14159;
    // ... a tight core falling off with distance from the ray, thicker in thicker mist.
    float thick = clamp(max(mistAt(lp), density * 0.6) / 0.02, 0.3, 2.0);
    // Halos stay a few metres across, and a lamp right by your head doesn't fill the view: close
    // up the halo shrinks with the distance, and one below your eye (a fire at your feet, a
    // lantern on a table) fades out sooner, so it doesn't stand in front of you as a bright block.
    float away = distance(lp, camPos);
    float below = clamp((camPos.y - lp.y - 0.3) / 1.2, 0.0, 1.0);
    float fade = (1.0 - smoothstep(lampPos[i].w * 0.6, lampPos[i].w, away))
      * smoothstep(3.0, 8.0, away)
      * mix(1.0, smoothstep(7.0, 16.0, away), below);
    float reach = clamp(away * 0.22, 0.8, 3.0);
    float f = seen * min(4.0, pow(0.6 / h, 1.6)) * (1.0 - smoothstep(reach * 0.35, reach, h)) * thick * 0.6 * fade;
    f = min(1.0, floor(min(f, 1.0) * BANDS + b) / BANDS);
    light += lampLight[i] * f;
  }

  gl_FragColor = vec4(light, T);
}
