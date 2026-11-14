import type * as THREE from 'three'
import {
  attribute,
  BRDF_Lambert,
  diffuseColor,
  F_Schlick,
  Fn,
  float,
  materialColor,
  mix,
  normalView,
  positionViewDirection,
  renderGroup,
  shininess,
  specularColor,
  texture,
  uniform,
  uv,
  vec2,
  vec4,
  vertexColor,
} from 'three/tsl'
import {
  type LightingModelDirectInput,
  type MeshPhongNodeMaterial,
  type Node,
  type NodeBuilder,
  PhongLightingModel,
} from 'three/webgpu'
import { DARKEN, wetUniforms } from './wet-ground.ts'

/*
 * TSL twin of wetGroundMaterial's patch (wet-ground.ts) for the WebGPU renderer: the big soft
 * patches, the mud and the soak, and the sheen only wet ground has. Keep the two in step.
 */

// Render group: the ground never changes, so per-object uniforms would never be refreshed.
const wet = uniform(0)
  .setGroup(renderGroup)
  .onRenderUpdate(() => wetUniforms.uWet.value)
const mudColor = uniform(wetUniforms.uMudColor.value).setGroup(renderGroup)

/** The `mud` attribute, or 0 on ground that has none (the far ground of forest-lod.ts). */
const mud = Fn((builder: NodeBuilder) =>
  builder.geometry.hasAttribute('mud') ? attribute<'float'>('mud', 'float') : float(0),
)

/** How strongly the ground shines: dry ground not at all (GLSL `specularStrength`). */
const specularStrength = (): Node<'float'> => wet.mul(wet).mul(mud().mul(0.85).add(0.15))

/** Blinn-Phong as three's PhongLightingModel, its specular scaled by specularStrength. */
class WetPhong extends PhongLightingModel {
  override direct({ lightDirection, lightColor, reflectedLight }: LightingModelDirectInput): void {
    const l = lightDirection as Node<'vec3'>
    const out = reflectedLight as unknown as Record<
      'directDiffuse' | 'directSpecular',
      Node<'vec3'>
    >
    const irradiance = normalView
      .dot(l)
      .clamp()
      .mul(lightColor as Node<'vec3'>)
    out.directDiffuse.addAssign(
      irradiance.mul(BRDF_Lambert({ diffuseColor }) as unknown as Node<'vec3'>),
    )
    const half = l.add(positionViewDirection).normalize()
    const dotNH = normalView.dot(half).clamp()
    const dotVH = positionViewDirection.dot(half).clamp()
    const f = F_Schlick({ f0: specularColor, f90: float(1), dotVH }) as unknown as Node<'vec3'>
    const d = shininess
      .mul(0.5)
      .add(1)
      .mul(1 / Math.PI)
      .mul(dotNH.pow(shininess))
    out.directSpecular.addAssign(irradiance.mul(f.mul(0.25).mul(d)).mul(specularStrength()))
  }
}

export function wetGround(m: MeshPhongNodeMaterial): void {
  const map = (m as MeshPhongNodeMaterial & { map: THREE.Texture | null }).map
  if (!map) return
  // Vertex colours are folded in below, before the mud and the soak (as color_fragment is).
  m.vertexColors = false
  m.colorNode = Fn(() => {
    const vMud = mud()
    // Big soft patches from the same texture, so the small repeat never lines up.
    const patches = mix(0.8, 1.22, texture(map, uv().mul(0.09).add(vec2(0.37, 0.61))).g)
    const base = materialColor.rgb.mul(patches).mul(vertexColor().rgb)
    const soak = wet.mul(vMud.mul(0.45).add(0.55))
    const rgb = mix(base, mudColor, wet.mul(vMud).mul(0.45)).mul(soak.mul(-DARKEN).add(1))
    return vec4(rgb, 1)
  })()
  m.setupLightingModel = () => new WetPhong()
}
