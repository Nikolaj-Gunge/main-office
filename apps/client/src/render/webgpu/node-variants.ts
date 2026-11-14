import * as THREE from 'three'
import type {
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  MeshPhongNodeMaterial,
  NodeMaterial,
  WebGPURenderer,
} from 'three/webgpu'
import { cornPosition } from '../corn.tsl.ts'
import { treeCard, treeline } from '../forest-lod.tsl.ts'
import { detailNormal, detailPosition } from '../ground-detail.tsl.ts'
import { skyNodeMaterial } from '../sky.tsl.ts'
import { weatherTwin } from '../weather-view.tsl.ts'
import { wetGround } from '../wet-ground.tsl.ts'
import { swayingPosition } from '../wind.tsl.ts'

/**
 * WebGPURenderer turns every classic material (MeshLambertMaterial…) into its node twin by
 * itself, but GLSL patches — onBeforeCompile and ShaderMaterial — mean nothing to it. This
 * hooks that conversion and gives the game's patched materials their TSL twins (the *.tsl.ts
 * files beside the GLSL), keyed by the customProgramCacheKey the GLSL patch already sets. The
 * materials in the scene stay the WebGL ones: nothing outside the renderer changes.
 */

type Variant = (node: NodeMaterial) => void

const VARIANTS: Record<string, Variant> = {
  // (The shadow pass reads node properties off the scene's own material, which has none: no
  // sway in the shadows, the same as the WebGL depth pass.)
  swaying: (m) => {
    m.positionNode = swayingPosition()
  },
  detail: (m) => {
    m.positionNode = detailPosition(true)
    m.normalNode = detailNormal()
  },
  'detail-glow': (m) => {
    m.positionNode = detailPosition(false)
  },
  corn: (m) => {
    m.positionNode = cornPosition()
  },
  'wet-ground': (m) => wetGround(m as MeshPhongNodeMaterial),
  'tree-card': (m) => treeCard(m as MeshLambertNodeMaterial),
  treeline: (m) => treeline(m as MeshBasicNodeMaterial),
}

const warned = new Set<string>()
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`[webgpu] ${message}`)
}

const skies = new WeakMap<THREE.Material, NodeMaterial>()

export function installNodeVariants(renderer: WebGPURenderer): void {
  // The weather's ShaderMaterials need the object as well (points become quads), so they are
  // swapped for their twins per draw rather than per material.
  renderer.setRenderObjectFunction(
    (object, scene, camera, geometry, material, group, lightsNode, clippingContext, passId) => {
      const twin = material instanceof THREE.ShaderMaterial ? weatherTwin(object, material) : null
      if (twin && twin.object !== object) {
        object.onBeforeRender(renderer as never, scene, camera, geometry, material, group as never)
        twin.sync()
        const o = twin.object as THREE.Mesh
        renderer.renderObject(
          o,
          scene,
          camera,
          o.geometry,
          twin.material,
          group,
          lightsNode,
          clippingContext,
          passId,
        )
        return
      }
      renderer.renderObject(
        object,
        scene,
        camera,
        geometry,
        twin ? twin.material : material,
        group,
        lightsNode,
        clippingContext,
        passId,
      )
    },
  )
  const library = renderer.library
  const base = library.fromMaterial.bind(library)
  library.fromMaterial = (material: THREE.Material) => {
    if ((material as NodeMaterial).isNodeMaterial) return material as NodeMaterial
    if (material instanceof THREE.ShaderMaterial) {
      const u = material.uniforms
      if (
        u.topColor?.value instanceof THREE.Color &&
        u.horizonColor?.value instanceof THREE.Color
      ) {
        let sky = skies.get(material)
        if (!sky) {
          sky = skyNodeMaterial(u as Parameters<typeof skyNodeMaterial>[0])
          skies.set(material, sky)
        }
        return sky
      }
      warnOnce(material.uuid, `no TSL twin for ShaderMaterial "${material.name}", not drawn`)
      return base(material)
    }
    const node = base(material)
    if (!node || material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile) return node
    const key = material.customProgramCacheKey()
    const variant = VARIANTS[key]
    if (variant) variant(node)
    else warnOnce(key, `no TSL twin for patched material "${key}", drawn unpatched`)
    return node
  }
}
