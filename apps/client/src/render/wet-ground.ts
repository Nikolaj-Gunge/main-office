import * as THREE from 'three'

/**
 * The survival ground's material: vertex colours (ground-colour.ts) over the speckle texture,
 * the texture sampled a second time at a much larger scale so the repeat doesn't show, and rain
 * that soaks in — the ground darkens, the mud most, and takes on a sheen that catches the moon,
 * the lamps and your torch. `uWet` is shared: one number wets every chunk.
 */
export const wetUniforms = {
  /** 0 dry … 1 soaked. */
  uWet: { value: 0 },
  uMudColor: { value: new THREE.Color(0x1e1810) },
  /** Snow lying on the ground, 0 none … 1 covered (weather-effects.ts snowCoverAt). */
  uSnow: { value: 0 },
  uSnowColor: { value: new THREE.Color(0xb4bcc8) },
}

/** How dark soaked ground gets, and how it shines. */
export const DARKEN = 0.4
const SHEEN = new THREE.Color(0x4a525c)

export function wetGroundMaterial(map: THREE.Texture): THREE.MeshPhongMaterial {
  const material = new THREE.MeshPhongMaterial({
    map,
    vertexColors: true,
    shininess: 34,
    specular: SHEEN,
  })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wetUniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float mud;\nvarying float vMud;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMud = mud;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vMud;\nuniform float uWet;\nuniform vec3 uMudColor;\nuniform float uSnow;\nuniform vec3 uSnowColor;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        // Big soft patches from the same texture, so the small repeat never lines up.
        diffuseColor.rgb *= mix(0.8, 1.22, texture2D(map, vMapUv * 0.09 + vec2(0.37, 0.61)).g);`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float soak = uWet * (0.55 + 0.45 * vMud);
        diffuseColor.rgb = mix(diffuseColor.rgb, uMudColor, uWet * vMud * 0.45);
        diffuseColor.rgb *= 1.0 - ${DARKEN.toFixed(2)} * soak;
        // Snow settles in patches first (the big texture pattern), then covers everything.
        float drift = texture2D(map, vMapUv * 0.05 + vec2(0.11, 0.83)).g;
        diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor, clamp(uSnow * 1.6 - drift * 0.6, 0.0, 1.0) * 0.92);`,
      )
      .replace(
        '#include <specularmap_fragment>',
        'float specularStrength = uWet * uWet * (0.15 + 0.85 * vMud);',
      )
  }
  material.customProgramCacheKey = () => 'wet-ground'
  return material
}
