import * as THREE from 'three'
import { cascadeShaderInstalled } from './cascades.ts'

const SHADOW_CALL =
  'getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )'

/** The whole line that applies a directional light's shadow (three r187). */
const SHADOW_LINE = `directLight.color *= ( directLight.visible && receiveShadow ) ? ${SHADOW_CALL} : 1.0;`

let installed = false

/** Whether fadeShadowEdges has patched the shaders (the WebGPU renderer follows suit). */
export const shadowEdgesFaded = (): boolean => installed

/**
 * Survival's shadow maps cover a square around you; with the haze lifted by day the outer one's
 * edge would show as a line across the forest. This fades directional shadows out over the
 * outer fifth of the map instead — and, with cascades (cascades.ts), takes the first directional
 * light's shadow from the smallest cascade that covers the pixel (the cascade lights after it
 * carry no light: they are there for their shadow maps). Patches three's
 * shader chunks, so call it before the first survival frame (materials compiled earlier keep
 * their programs).
 */
export function fadeShadowEdges(): void {
  if (installed) return
  const lights = THREE.ShaderChunk.lights_fragment_begin
  if (!lights.includes(SHADOW_LINE)) {
    console.warn('shadow-fade: three.js shader changed, shadows keep their hard edge')
    return
  }
  installed = true
  cascadeShaderInstalled(true)
  THREE.ShaderChunk.lights_fragment_begin = lights.replace(
    SHADOW_LINE,
    `#if UNROLLED_LOOP_INDEX == 0
\t\tdirectLight.color *= ( directLight.visible && receiveShadow ) ? cascadedShadow() : 1.0;
\t\t#endif`,
  )
  THREE.ShaderChunk.shadowmap_pars_fragment = `${THREE.ShaderChunk.shadowmap_pars_fragment}
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
float shadowEdgeFade( float shadow, vec4 coord ) {
  vec2 edge = abs( coord.xy / coord.w * 2.0 - 1.0 );
  return mix( shadow, 1.0, smoothstep( 0.75, 0.97, max( edge.x, edge.y ) ) );
}
// Inside cascade k's map, with a margin for the filter's taps.
bool inCascade( vec4 coord ) {
  vec3 c = coord.xyz / coord.w;
  return all( greaterThan( c, vec3( 0.01, 0.01, 0.0 ) ) ) && all( lessThan( c, vec3( 0.99, 0.99, 1.0 ) ) );
}
#define CASCADE_SHADOW( k ) getShadow( directionalShadowMap[ k ], directionalLightShadows[ k ].shadowMapSize, directionalLightShadows[ k ].shadowIntensity, directionalLightShadows[ k ].shadowBias, directionalLightShadows[ k ].shadowRadius, vDirectionalShadowCoord[ k ] )
float cascadedShadow() {
  #if NUM_DIR_LIGHT_SHADOWS > 2
  if ( inCascade( vDirectionalShadowCoord[ 0 ] ) ) return CASCADE_SHADOW( 0 );
  if ( inCascade( vDirectionalShadowCoord[ 1 ] ) ) return CASCADE_SHADOW( 1 );
  return shadowEdgeFade( CASCADE_SHADOW( 2 ), vDirectionalShadowCoord[ 2 ] );
  #elif NUM_DIR_LIGHT_SHADOWS > 1
  if ( inCascade( vDirectionalShadowCoord[ 0 ] ) ) return CASCADE_SHADOW( 0 );
  return shadowEdgeFade( CASCADE_SHADOW( 1 ), vDirectionalShadowCoord[ 1 ] );
  #else
  return shadowEdgeFade( CASCADE_SHADOW( 0 ), vDirectionalShadowCoord[ 0 ] );
  #endif
}
#endif
`
}
