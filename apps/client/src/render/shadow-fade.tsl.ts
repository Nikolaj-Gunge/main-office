import { max, mix, PCFShadowFilter, smoothstep } from 'three/tsl'
import type { Node } from 'three/webgpu'

/*
 * TSL twin of shadowEdgeFade (shadow-fade.ts) for the WebGPU renderer: three's PCF filter, faded
 * out over the outer edge of the shadow map. Set as a directional light's shadow.filterNode.
 */
interface FilterInputs {
  shadowCoord: Node<'vec3'>
}
const pcf = PCFShadowFilter as unknown as (inputs: FilterInputs) => Node<'float'>

export const fadedShadowFilter = (inputs: FilterInputs): Node<'float'> => {
  const edge = inputs.shadowCoord.xy.mul(2).sub(1).abs()
  return mix(pcf(inputs), 1, smoothstep(0.75, 0.97, max(edge.x, edge.y)))
}
