import type * as THREE from 'three'
import {
  abs,
  attribute,
  cameraPosition,
  Fn,
  min,
  mix,
  normalize,
  output,
  positionGeometry,
  positionView,
  reference,
  renderGroup,
  select,
  smoothstep,
  texture,
  transformNormalToView,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type {
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  Node,
  NodeBuilder,
} from 'three/webgpu'
import { CARD_H, CARD_W, TILES } from './forest-lod.ts'

/*
 * TSL twins of the far forest's patches (forest-lod.ts) for the WebGPU renderer: tree cards
 * that turn to face you, and the treeline's capped fog. Keep them in step with the GLSL.
 */

/** cardMaterial: placed, turned and tiled from the instance's cardPos / cardLook. */
export function treeCard(m: MeshLambertNodeMaterial): void {
  const map = (m as MeshLambertNodeMaterial & { map: THREE.Texture | null }).map
  if (!map) return
  const cardPos = attribute<'vec4'>('cardPos', 'vec4')
  const cardLook = attribute<'vec2'>('cardLook', 'vec2')
  const cardFace = normalize(cameraPosition.xz.sub(cardPos.xz).add(vec2(1e-4, 0)))
  m.positionNode = cardPos.xyz
    .add(
      vec3(cardFace.y, 0, cardFace.x.negate()).mul(positionGeometry.x.mul(cardPos.w).mul(CARD_W)),
    )
    .add(vec3(0, positionGeometry.y.mul(cardPos.w).mul(CARD_H), 0))
  m.normalNode = transformNormalToView(normalize(vec3(cardFace.x.mul(0.7), 1, cardFace.y.mul(0.7))))
  const cardU = select(cardLook.y.lessThan(0), uv().x.oneMinus(), uv().x)
  const texel = texture(map, vec2(cardLook.x.add(cardU).div(TILES), uv().y))
  const shade = abs(cardLook.y)
  m.colorNode = vec4(texel.rgb.mul(uniform(m.color)).mul(shade), texel.a)
}

/** treelineMaterial: through the day's haze a faint line of trees; at night nothing. */
export function treeline(m: MeshBasicNodeMaterial): void {
  m.setupFog = (builder: NodeBuilder, outputNode: Node<'vec4'>) => {
    const fog = (builder as NodeBuilder & { scene: THREE.Scene }).scene.fog as THREE.Fog | null
    if (!fog?.isFog) return outputNode
    const near = reference('near', 'float', fog).setGroup(renderGroup)
    const far = reference('far', 'float', fog).setGroup(renderGroup)
    const color = reference('color', 'color', fog).setGroup(renderGroup)
    output.assign(outputNode)
    return Fn(() => {
      const treelineFog = smoothstep(near, far, positionView.z.negate())
      const treelineCap = mix(1, 0.84, smoothstep(170, 380, far))
      return vec4(mix(output.rgb, color, min(treelineFog, treelineCap)), output.a)
    })()
  }
}
