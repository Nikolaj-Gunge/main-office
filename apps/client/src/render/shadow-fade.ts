import * as THREE from 'three'

const SHADOW_CALL =
  'getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )'

let installed = false

/** Whether fadeShadowEdges has patched the shaders (the WebGPU renderer follows suit). */
export const shadowEdgesFaded = (): boolean => installed

/**
 * Survival's one shadow map covers ±80 m around you; with the haze lifted by day its square
 * edge would show as a line across the forest. This fades directional shadows out over the
 * outer fifth of the map instead. Patches three's shader chunks, so call it before the first
 * survival frame (materials compiled earlier keep their programs).
 */
export function fadeShadowEdges(): void {
  if (installed) return
  const lights = THREE.ShaderChunk.lights_fragment_begin
  if (!lights.includes(SHADOW_CALL)) {
    console.warn('shadow-fade: three.js shader changed, shadows keep their hard edge')
    return
  }
  installed = true
  THREE.ShaderChunk.lights_fragment_begin = lights.replace(
    SHADOW_CALL,
    `shadowEdgeFade( ${SHADOW_CALL}, vDirectionalShadowCoord[ i ] )`,
  )
  THREE.ShaderChunk.shadowmap_pars_fragment = `${THREE.ShaderChunk.shadowmap_pars_fragment}
#ifdef USE_SHADOWMAP
float shadowEdgeFade( float shadow, vec4 coord ) {
  vec2 edge = abs( coord.xy / coord.w * 2.0 - 1.0 );
  return mix( shadow, 1.0, smoothstep( 0.75, 0.97, max( edge.x, edge.y ) ) );
}
#endif
`
}
