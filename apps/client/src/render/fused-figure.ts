import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Draws a box figure (avatar.ts) in a handful of draw calls instead of one per box: every visible
 * mesh under the part groups is baked, in its part's own space, into one skinned mesh per
 * material, each vertex tied wholly to its part. The part groups themselves are the bones, so
 * everything that moves them (poses, the run cycle, flinches, ragdoll poses) moves the baked
 * boxes exactly as before: same triangles, same materials, same look.
 *
 * The original meshes stay in place but hidden; `clear()` shows them again before anything
 * changes what is worn or held, and `build()` bakes the new set.
 */
export class FusedFigure {
  private readonly skeleton: THREE.Skeleton
  private readonly meshes: THREE.SkinnedMesh[] = []
  private readonly hidden: THREE.Mesh[] = []
  /** Where culling thinks the figure is: round its chest, in the root's space. */
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 1.6)

  constructor(
    private readonly root: THREE.Object3D,
    private readonly bones: readonly THREE.Object3D[],
  ) {
    // Bones are plain groups (Skeleton only reads their world matrices); vertices are already in
    // their part's space, so every inverse bind matrix is the identity.
    this.skeleton = new THREE.Skeleton(
      bones as unknown as THREE.Bone[],
      bones.map(() => new THREE.Matrix4()),
    )
  }

  get fused(): boolean {
    return this.meshes.length > 0
  }

  /** Bakes what is visible now. */
  build(): void {
    this.clear()
    const sets = new Map<string, { mesh: THREE.Mesh; bone: number; matrix: THREE.Matrix4 }[]>()
    this.bones.forEach((bone, index) => {
      const visit = (o: THREE.Object3D, above: THREE.Matrix4) => {
        for (const child of o.children) {
          if (!child.visible) continue
          child.updateMatrix()
          const matrix = above.clone().multiply(child.matrix)
          if (child instanceof THREE.Mesh && !Array.isArray(child.material)) {
            const m = child.material as THREE.Material
            const key = `${m.uuid}:${child.castShadow}:${child.customDepthMaterial?.uuid ?? ''}`
            sets.set(key, [...(sets.get(key) ?? []), { mesh: child, bone: index, matrix }])
          }
          if (!(child instanceof THREE.Sprite)) visit(child, matrix)
        }
      }
      visit(bone, new THREE.Matrix4())
    })
    for (const set of sets.values()) {
      const first = set[0]
      if (!first) continue
      const geometries = set.map(({ mesh, bone, matrix }) => skinned(mesh.geometry, bone, matrix))
      const merged = mergeGeometries(common(geometries))
      for (const g of geometries) g.dispose()
      if (!merged) continue
      const mesh = new THREE.SkinnedMesh(merged, first.mesh.material)
      mesh.name = 'fused'
      mesh.castShadow = first.mesh.castShadow
      mesh.receiveShadow = first.mesh.receiveShadow
      if (first.mesh.customDepthMaterial) mesh.customDepthMaterial = first.mesh.customDepthMaterial
      mesh.bind(this.skeleton, new THREE.Matrix4())
      mesh.boundingSphere = this.sphere
      this.root.add(mesh)
      this.meshes.push(mesh)
      for (const { mesh: original } of set) {
        original.visible = false
        this.hidden.push(original)
      }
    }
  }

  /** Back to the separate meshes (before gear, weapon or armband change). */
  clear(): void {
    for (const mesh of this.meshes) {
      mesh.removeFromParent()
      mesh.geometry.dispose()
    }
    this.meshes.length = 0
    for (const mesh of this.hidden) mesh.visible = true
    this.hidden.length = 0
  }

  /** Keeps the culling sphere on the figure (its parts are placed in the root's space). */
  follow(center: THREE.Vector3, size: number): void {
    this.sphere.center.copy(center)
    this.sphere.radius = 1.6 * size
  }
}

/** A copy of `geometry` moved into its bone's space, every vertex wholly on that bone. */
function skinned(
  geometry: THREE.BufferGeometry,
  bone: number,
  matrix: THREE.Matrix4,
): THREE.BufferGeometry {
  const g = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(matrix)
  g.clearGroups()
  const count = g.getAttribute('position').count
  const index = new Uint16Array(count * 4)
  const weight = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    index[i * 4] = bone
    weight[i * 4] = 1
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(index, 4))
  g.setAttribute('skinWeight', new THREE.BufferAttribute(weight, 4))
  return g
}

/** Keeps only the attributes every geometry has (mergeGeometries needs them all alike). */
function common(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry[] {
  const first = geometries[0]
  if (!first) return geometries
  const names = Object.keys(first.attributes).filter((name) =>
    geometries.every((g) => g.getAttribute(name) !== undefined),
  )
  for (const g of geometries) {
    for (const name of Object.keys(g.attributes)) if (!names.includes(name)) g.deleteAttribute(name)
    g.morphAttributes = {}
  }
  return geometries
}
